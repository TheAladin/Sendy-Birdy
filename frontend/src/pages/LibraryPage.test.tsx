import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import type { ItemSummary } from "../api/items";
import { json, LIMITS, mockApi } from "../test/api";
import { renderRoute } from "../test/render";

const USER = { id: "u1", email: "me@example.com", display_name: "Alex" };
const HOUR = 3600 * 1000;

function item(overrides: Partial<ItemSummary> & Pick<ItemSummary, "title">): ItemSummary {
  return {
    id: crypto.randomUUID(),
    kind: "image",
    original_filename: `${overrides.title}.png`,
    mime_type: "image/png",
    size_bytes: 1536,
    width: 1440,
    height: 900,
    duration_s: null,
    has_thumbnail: true,
    share_count: 0,
    created_at: new Date(Date.now() - 3 * HOUR).toISOString(),
    updated_at: new Date().toISOString(),
    excerpt: null,
    ...overrides,
  };
}

const SCREENSHOT = item({ title: "Homepage redesign" });
const VIDEO = item({
  title: "Onboarding walkthrough",
  kind: "video",
  mime_type: "video/quicktime",
  size_bytes: 2_400_000,
  duration_s: 75,
});
const NOTE = item({
  title: "Release notes",
  kind: "note",
  mime_type: null,
  size_bytes: null,
  original_filename: null,
  has_thumbnail: false,
  excerpt: "# v2.3 New checkout flow",
});

afterEach(() => {
  vi.restoreAllMocks();
});

function libraryApi(handler: (url: URL) => Response) {
  return mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items": (request) => handler(new URL(request.url)),
    "GET /api/items/upload-limits": () => json(LIMITS),
  });
}

const requestedUrls = (spy: ReturnType<typeof mockApi>) =>
  spy.mock.calls
    .map(([request]) => new URL((request as Request).url))
    .filter((url) => url.pathname === "/api/items");

test("items are shown as cards with their details", async () => {
  libraryApi(() => json({ items: [SCREENSHOT, VIDEO, NOTE], next_cursor: null }));

  renderRoute("/");

  const card = await screen.findByRole("article", { name: "Homepage redesign" });
  expect(card).toHaveTextContent("PNG · 1.5 KB · 3 hours ago");
  expect(within(card).getByText("3 hours ago")).toHaveAttribute("datetime", SCREENSHOT.created_at);
  expect(card.querySelector("img")).toHaveAttribute("src", `/api/items/${SCREENSHOT.id}/thumbnail`);

  const video = screen.getByRole("article", { name: "Onboarding walkthrough" });
  expect(within(video).getByText("1:15")).toBeInTheDocument();
  expect(within(video).getByText(/MOV · 2.3 MB/)).toBeInTheDocument();

  const note = screen.getByRole("article", { name: "Release notes" });
  expect(within(note).getByText("# v2.3 New checkout flow")).toBeInTheDocument();
  expect(note.querySelector("img")).toBeNull();
});

test("filtering by type updates the address and the request", async () => {
  const api = libraryApi(() => json({ items: [SCREENSHOT], next_cursor: null }));
  const { router } = renderRoute("/");

  await userEvent.click(await screen.findByRole("link", { name: "Videos" }));

  await waitFor(() => expect(router.state.location.search).toBe("?kind=video"));
  expect(screen.getByRole("link", { name: "Videos" })).toHaveAttribute("aria-current", "page");
  await waitFor(() => expect(requestedUrls(api).at(-1)?.searchParams.get("kind")).toBe("video"));
});

test("search waits for a pause in typing before asking the server", async () => {
  const api = libraryApi(() => json({ items: [], next_cursor: null }));
  const { router } = renderRoute("/");

  await userEvent.type(await screen.findByRole("searchbox", { name: "Search titles" }), "check");

  await waitFor(() => expect(router.state.location.search).toBe("?q=check"));
  await waitFor(() => expect(requestedUrls(api).at(-1)?.searchParams.get("q")).toBe("check"));
  // One request for the empty search, one after the pause; not one per letter.
  expect(requestedUrls(api).length).toBe(2);
});

test("the address restores filters and search after a reload", async () => {
  const api = libraryApi(() => json({ items: [], next_cursor: null }));

  renderRoute("/?kind=note&q=release");

  expect(await screen.findByRole("searchbox", { name: "Search titles" })).toHaveValue("release");
  expect(screen.getByRole("link", { name: "Notes" })).toHaveAttribute("aria-current", "page");
  const url = requestedUrls(api)[0];
  expect([url?.searchParams.get("kind"), url?.searchParams.get("q")]).toEqual(["note", "release"]);
});

test("more items load on request, using the cursor", async () => {
  const api = libraryApi((url) =>
    url.searchParams.get("cursor") === "page-2"
      ? json({ items: [NOTE], next_cursor: null })
      : json({ items: [SCREENSHOT, VIDEO], next_cursor: "page-2" }),
  );
  renderRoute("/");

  await userEvent.click(await screen.findByRole("button", { name: "Load more" }));

  expect(await screen.findByRole("article", { name: "Release notes" })).toBeInTheDocument();
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  expect(requestedUrls(api).at(-1)?.searchParams.get("cursor")).toBe("page-2");
});

test("an empty library explains what goes here", async () => {
  libraryApi(() => json({ items: [], next_cursor: null }));

  renderRoute("/");

  expect(await screen.findByRole("heading", { name: "Your library is empty" })).toBeInTheDocument();
});

test("a search without results offers a way back", async () => {
  libraryApi(() => json({ items: [], next_cursor: null }));
  const { router } = renderRoute("/?q=zebra");

  expect(await screen.findByText('No items with "zebra" in their title.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "Show everything" }));

  await waitFor(() => expect(router.state.location.search).toBe(""));
  expect(screen.getByRole("searchbox", { name: "Search titles" })).toHaveValue("");
});

test("a failure to load offers a retry", async () => {
  let fail = true;
  libraryApi(() =>
    fail ? json({ detail: "boom" }, 500) : json({ items: [NOTE], next_cursor: null }),
  );
  renderRoute("/");

  expect(
    await screen.findByText("The library couldn't be loaded.", {}, { timeout: 4000 }),
  ).toBeInTheDocument();
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByRole("article", { name: "Release notes" })).toBeInTheDocument();
});
