import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import type { ItemSummary } from "../../api/items";
import { json, LIMITS, mockApi } from "../../test/api";
import { renderRoute } from "../../test/render";

const USER = { id: "u1", email: "me@example.com", display_name: "Alex" };

function item(id: string, overrides: Partial<ItemSummary>): ItemSummary {
  return {
    id,
    kind: "image",
    title: id,
    original_filename: `${id}.png`,
    mime_type: "image/png",
    size_bytes: 33_000,
    width: 1440,
    height: 900,
    duration_s: null,
    has_thumbnail: true,
    created_at: "2026-11-01T10:30:00Z",
    updated_at: "2026-11-01T10:30:00Z",
    excerpt: null,
    ...overrides,
  };
}

const PRICING = item("pricing", { title: "Pricing page" });
const DEMO = item("demo", {
  title: "Onboarding walkthrough",
  kind: "video",
  mime_type: "video/mp4",
  original_filename: "walkthrough.mp4",
  width: 1280,
  height: 720,
  duration_s: 5,
});
const NOTES = item("notes", {
  title: "Release notes",
  kind: "note",
  mime_type: null,
  original_filename: null,
  size_bytes: null,
  width: null,
  height: null,
  has_thumbnail: false,
  excerpt: "Release notes",
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(nextCursor: string | null = null) {
  return mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items": (request) =>
      new URL(request.url).searchParams.get("cursor")
        ? json({ items: [item("later", { title: "Loaded later" })], next_cursor: null })
        : json({ items: [PRICING, DEMO, NOTES], next_cursor: nextCursor }),
    "GET /api/items/upload-limits": () => json(LIMITS),
    "GET /api/items/notes": () => json({ ...NOTES, body: "# Release notes\n\n- Apple Pay" }),
  });
}

async function openFirst(user: ReturnType<typeof userEvent.setup>) {
  renderRoute("/");
  const open = await screen.findByRole("button", { name: "Open Pricing page" });
  await user.click(open);
  return { open, viewer: screen.getByRole("dialog", { name: "Pricing page" }) };
}

test("opening an item shows it full size with its details", async () => {
  const user = userEvent.setup();
  setup();
  const { viewer } = await openFirst(user);

  expect(within(viewer).getByRole("img", { name: "Pricing page" })).toHaveAttribute(
    "src",
    "/api/items/pricing/file",
  );
  expect(within(viewer).getByText("1 of 3")).toBeInTheDocument();
  const details = within(viewer).getByRole("complementary", { name: "Details" });
  expect(details).toHaveTextContent("PNG image");
  expect(details).toHaveTextContent("32 KB");
  expect(details).toHaveTextContent("1440 × 900");
  expect(details).toHaveTextContent("pricing.png");
  expect(within(viewer).getByRole("link", { name: "Download" })).toHaveAttribute(
    "href",
    "/api/items/pricing/file?download=1",
  );
});

test("the arrow keys move between items, stopping at either end", async () => {
  const user = userEvent.setup();
  setup();
  await openFirst(user);

  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("dialog", { name: "Pricing page" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous item" })).toBeDisabled();

  await user.keyboard("{ArrowRight}");
  const video = screen.getByRole("dialog", { name: "Onboarding walkthrough" });
  expect(within(video).getByText("2 of 3")).toBeInTheDocument();
  expect(video.querySelector("video")).toHaveAttribute("src", "/api/items/demo/file");
  expect(video.querySelector("video")).toHaveAttribute("controls");
  expect(within(video).getByRole("complementary")).toHaveTextContent("0:05");

  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("dialog", { name: "Release notes" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next item" })).toBeDisabled();
});

test("arrow keys inside a video are left to the video's own controls", async () => {
  const user = userEvent.setup();
  setup();
  await openFirst(user);
  await user.keyboard("{ArrowRight}");
  const video = screen
    .getByRole("dialog", { name: "Onboarding walkthrough" })
    .querySelector("video");

  // jsdom can't focus <video> (real browsers can), so send the key press to it directly.
  fireEvent.keyDown(video!, { key: "ArrowRight" });

  expect(screen.getByRole("dialog", { name: "Onboarding walkthrough" })).toBeInTheDocument();
});

test("a note is shown as formatted text", async () => {
  const user = userEvent.setup();
  setup();
  renderRoute("/");

  await user.click(await screen.findByRole("button", { name: "Open Release notes" }));

  const viewer = screen.getByRole("dialog", { name: "Release notes" });
  // The note's own heading (the viewer's title is an h2).
  expect(
    await within(viewer).findByRole("heading", { level: 1, name: "Release notes" }),
  ).toBeInTheDocument();
  expect(within(viewer).getByRole("listitem")).toHaveTextContent("Apple Pay");
  expect(within(viewer).queryByRole("link", { name: "Download" })).not.toBeInTheDocument();
});

test("Esc closes the viewer and puts focus back on the card", async () => {
  const user = userEvent.setup();
  setup();
  const { open, viewer } = await openFirst(user);

  viewer.dispatchEvent(new Event("cancel", { cancelable: true }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(open).toHaveFocus();
});

test("details can be hidden", async () => {
  const user = userEvent.setup();
  setup();
  const { viewer } = await openFirst(user);

  await user.click(within(viewer).getByRole("button", { name: "Hide details" }));

  expect(within(viewer).getByRole("button", { name: "Show details" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("reaching the last loaded item loads more, so browsing can continue", async () => {
  const user = userEvent.setup();
  setup("page-2");
  await openFirst(user);

  await user.keyboard("{ArrowRight}{ArrowRight}");
  await waitFor(() => expect(screen.getByText("3 of 4")).toBeInTheDocument());
  await user.keyboard("{ArrowRight}");

  expect(screen.getByRole("dialog", { name: "Loaded later" })).toBeInTheDocument();
});
