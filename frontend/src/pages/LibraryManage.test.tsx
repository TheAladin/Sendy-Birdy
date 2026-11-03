import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ItemSummary } from "../api/items";
import { json, LIMITS, mockApi } from "../test/api";
import { renderRoute } from "../test/render";

const USER = { id: "u1", email: "me@example.com", display_name: "Alex" };

function item(id: string, title: string): ItemSummary {
  return {
    id,
    kind: "image",
    title,
    original_filename: `${id}.png`,
    mime_type: "image/png",
    size_bytes: 1000,
    width: 100,
    height: 100,
    duration_s: null,
    has_thumbnail: true,
    share_count: 0,
    created_at: "2026-11-01T10:30:00Z",
    updated_at: "2026-11-01T10:30:00Z",
    excerpt: null,
  };
}

// What the fake server holds; handlers change it like the real one would.
let library: ItemSummary[];

beforeEach(() => {
  library = [
    item("a", "Homepage"),
    item("b", "Pricing page"),
    item("c", "Checkout"),
    item("d", "Dashboard"),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A response the test releases when it wants, to see the grid before the server answers. */
function later() {
  let release!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => (release = resolve));
  return { promise, release };
}

function setup(handlers: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items": () => json({ items: library, next_cursor: null }),
    "GET /api/items/upload-limits": () => json(LIMITS),
    ...handlers,
  });
}

const titles = () =>
  screen.getAllByRole("article").map((card) => within(card).getByRole("heading").textContent);

async function openMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole("button", { name: `Actions for ${title}` }));
}

test("an item can be renamed in place", async () => {
  const user = userEvent.setup();
  const answer = later();
  const api = setup({ "PATCH /api/items/b": () => answer.promise });
  renderRoute("/");

  await openMenu(user, "Pricing page");
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  const input = screen.getByRole("textbox", { name: "New title for Pricing page" });
  expect(input).toHaveFocus();
  expect(input).toHaveValue("Pricing page");

  await user.clear(input);
  await user.type(input, "Pricing v2{Enter}");

  // Shown at once, before the server has answered.
  expect(screen.getByRole("heading", { name: "Pricing v2" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Pricing v2" })).toHaveFocus();
  const patch = api.mock.calls.map(([r]) => r as Request).find((r) => r.method === "PATCH");
  expect(await patch?.json()).toEqual({ title: "Pricing v2" });

  library[1] = { ...item("b", "Pricing v2") };
  answer.release(json({ ...library[1], body: null }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Pricing v2" })).toBeInTheDocument(),
  );
});

test("Esc or an empty title cancels renaming", async () => {
  const user = userEvent.setup();
  const api = setup();
  renderRoute("/");

  await openMenu(user, "Checkout");
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.keyboard("Something else{Escape}");
  expect(screen.getByRole("heading", { name: "Checkout" })).toBeInTheDocument();

  await openMenu(user, "Checkout");
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.clear(screen.getByRole("textbox", { name: "New title for Checkout" }));
  await user.keyboard("{Enter}");
  expect(screen.getByRole("heading", { name: "Checkout" })).toBeInTheDocument();

  expect(api.mock.calls.some(([r]) => (r as Request).method === "PATCH")).toBe(false);
});

test("a refused rename puts the old title back", async () => {
  const user = userEvent.setup();
  setup({ "PATCH /api/items/c": () => json({ detail: "Item not found" }, 404) });
  renderRoute("/");

  await openMenu(user, "Checkout");
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.keyboard("{Control>}a{/Control}Cart{Enter}");

  expect(await screen.findByText("Couldn't rename")).toBeInTheDocument();
  expect(screen.getByText("Item not found")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Checkout" })).toBeInTheDocument();
});

test("deleting one item asks first, then removes it at once", async () => {
  const user = userEvent.setup();
  const answer = later();
  setup({ "DELETE /api/items/b": () => answer.promise });
  renderRoute("/");

  await openMenu(user, "Pricing page");
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));
  const confirm = screen.getByRole("dialog", { name: 'Delete "Pricing page"?' });
  await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("heading", { name: "Pricing page" })).toBeInTheDocument();

  await openMenu(user, "Pricing page");
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Pricing page" })).not.toBeInTheDocument(),
  );
  // Focus moves to the card that took its place.
  expect(screen.getByRole("button", { name: "Open Checkout" })).toHaveFocus();

  library = library.filter((other) => other.id !== "b");
  answer.release(new Response(null, { status: 204 }));
  expect(await screen.findByText('Deleted "Pricing page"')).toBeInTheDocument();
  expect(titles()).toEqual(["Homepage", "Checkout", "Dashboard"]);
});

test("Shift-click selects a range, which can be deleted together", async () => {
  const user = userEvent.setup();
  const api = setup({
    "POST /api/items/bulk-delete": async (request) => {
      const { ids } = (await request.json()) as { ids: string[] };
      library = library.filter((other) => !ids.includes(other.id));
      return json({ deleted: ids.length });
    },
  });
  renderRoute("/");

  await user.click(await screen.findByRole("button", { name: "Select" }));
  expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("checkbox", { name: "Select Homepage" }));
  await user.keyboard("{Shift>}");
  await user.click(screen.getByRole("checkbox", { name: "Select Checkout" }));
  await user.keyboard("{/Shift}");

  const bar = screen.getByRole("region", { name: "Selection" });
  expect(within(bar).getByText("3 selected")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Select Pricing page" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Select Dashboard" })).not.toBeChecked();

  await user.click(within(bar).getByRole("button", { name: "Delete" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete 3 items?" })).getByRole("button", {
      name: "Delete",
    }),
  );

  await waitFor(() => expect(titles()).toEqual(["Dashboard"]));
  expect(screen.queryByRole("region", { name: "Selection" })).not.toBeInTheDocument();
  expect(await screen.findByText("Deleted 3 items")).toBeInTheDocument();
  const bulk = api.mock.calls.map(([r]) => r as Request).find((r) => r.method === "POST");
  expect(bulk).toBeDefined();
});

test("a failed delete brings the items back", async () => {
  const user = userEvent.setup();
  setup({ "DELETE /api/items/a": () => json({ detail: "Boom" }, 500) });
  renderRoute("/");

  await openMenu(user, "Homepage");
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

  expect(await screen.findByText("Couldn't delete")).toBeInTheDocument();
  expect(titles()).toEqual(["Homepage", "Pricing page", "Checkout", "Dashboard"]);
});

test("selection mode: select all, and Esc to leave", async () => {
  const user = userEvent.setup();
  setup();
  renderRoute("/");

  await openMenu(user, "Checkout");
  await user.click(screen.getByRole("menuitem", { name: "Select" }));
  const bar = screen.getByRole("region", { name: "Selection" });
  expect(within(bar).getByText("1 selected")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();

  await user.click(within(bar).getByRole("button", { name: "Select all" }));
  expect(within(bar).getByText("4 selected")).toBeInTheDocument();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Selection" })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
