import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { json, mockApi } from "../test/api";
import { renderRoute } from "../test/render";

const USER = {
  id: "4f1c9d6e-0000-4000-8000-000000000001",
  email: "me@example.com",
  display_name: "Alex",
};

beforeEach(() => {
  mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items": () => json({ items: [], next_cursor: null }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

test("the navigation marks the current page and moves between sections", async () => {
  const { router } = renderRoute("/");
  const nav = await screen.findByRole("navigation", { name: "Main" });

  expect(within(nav).getByRole("link", { name: "Library" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(document.title).toBe("Library · Sendy Birdy");

  await userEvent.click(within(nav).getByRole("link", { name: "Shares" }));

  expect(await screen.findByRole("heading", { name: "Shares" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/shares");
  expect(within(nav).getByRole("link", { name: "Shares" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "Library" })).not.toHaveAttribute("aria-current");
  expect(document.title).toBe("Shares · Sendy Birdy");
});

test("the account area shows who is signed in", async () => {
  renderRoute("/activity");

  expect(await screen.findByText("Alex")).toBeInTheDocument();
  expect(screen.getByText("me@example.com")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});

test("the theme switcher applies and remembers the choice", async () => {
  renderRoute("/");
  const theme = await screen.findByRole("group", { name: "Theme" });
  expect(within(theme).getByRole("radio", { name: "System" })).toBeChecked();

  await userEvent.click(within(theme).getByRole("radio", { name: "Dark" }));

  expect(document.documentElement).toHaveClass("dark");
  expect(localStorage.getItem("sendy-theme")).toBe("dark");

  await userEvent.click(within(theme).getByRole("radio", { name: "Light" }));
  expect(document.documentElement).not.toHaveClass("dark");

  await userEvent.click(within(theme).getByRole("radio", { name: "System" }));
  expect(localStorage.getItem("sendy-theme")).toBeNull();
});

test("on small screens the menu button opens the navigation, and following a link closes it", async () => {
  renderRoute("/");

  await userEvent.click(await screen.findByRole("button", { name: "Open navigation" }));
  const sheet = screen.getByRole("dialog", { name: "Navigation" });
  await userEvent.click(within(sheet).getByRole("link", { name: "Activity" }));

  expect(await screen.findByRole("heading", { name: "Activity" })).toBeInTheDocument();
  expect(sheet).not.toHaveAttribute("open");
});

test("a skip link lets keyboard users jump past the navigation", async () => {
  renderRoute("/");
  await screen.findByRole("heading", { name: "Library" });

  await userEvent.tab();

  expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
  expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  expect(await screen.findByRole("main")).toHaveAttribute("id", "main");
});
