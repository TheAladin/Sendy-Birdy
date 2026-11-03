import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import type { AccessEvent } from "../api/activity";
import type { ShareSummary } from "../api/shares";
import { json, LIMITS, mockApi } from "../test/api";
import { renderRoute } from "../test/render";

const USER = { id: "u1", email: "me@example.com", display_name: "Alex" };
const HOUR = 3600 * 1000;
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function event(id: string, overrides: Partial<AccessEvent>): AccessEvent {
  return {
    id,
    kind: "share_viewed",
    created_at: new Date(Date.now() - 2 * HOUR).toISOString(),
    share_id: "s1",
    share_title: "Northwind round 2",
    item_id: null,
    item_title: null,
    ip: "203.0.113.7",
    user_agent: IPHONE,
    ...overrides,
  };
}

const EVENTS = [
  event("e1", {}),
  event("e2", { kind: "file_downloaded", item_id: "i1", item_title: "Hero.png" }),
  event("e3", { kind: "login_failed", share_id: null, share_title: null, user_agent: null }),
  event("e4", { kind: "share_viewed", share_id: null, share_title: "Deleted link" }),
];

const SHARE: ShareSummary = {
  id: "s1",
  title: "Northwind round 2",
  url: "https://share.example.com/s/token",
  status: "active",
  expires_at: null,
  revoked_at: null,
  allow_downloads: true,
  has_password: false,
  view_count: 1,
  last_viewed_at: null,
  item_count: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(answer: (url: URL) => Response = () => json({ events: EVENTS, next_cursor: null })) {
  return mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items/upload-limits": () => json(LIMITS),
    "GET /api/shares": () => json([SHARE]),
    "GET /api/activity": (request) => answer(new URL(request.url)),
  });
}

const activityRequests = (api: ReturnType<typeof mockApi>) =>
  api.mock.calls
    .map(([request]) => new URL((request as Request).url))
    .filter((url) => url.pathname === "/api/activity");

test("events are listed with what, which link, when, where from and which browser", async () => {
  setup();
  renderRoute("/activity");

  const table = await screen.findByRole("table");
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows[0]).toHaveTextContent("Link opened");
  expect(rows[0]).toHaveTextContent("Northwind round 2");
  expect(rows[0]).toHaveTextContent("2 hours ago");
  expect(rows[0]).toHaveTextContent("203.0.113.7");
  expect(rows[0]).toHaveTextContent("Safari on iPhone");
  expect(rows[1]).toHaveTextContent("File downloaded");
  expect(rows[1]).toHaveTextContent("Hero.png from Northwind round 2");
  expect(rows[2]).toHaveTextContent("Sign-in failed");
  expect(rows[2]).toHaveTextContent("Unknown browser");
  // The exact time is on hover.
  expect(within(rows[0]).getByText("2 hours ago")).toHaveAttribute("title");
  // A deleted link keeps its title, without a link to filter by.
  expect(within(rows[3]).getByText("Deleted link").tagName).toBe("SPAN");
  expect(within(rows[0]).getByRole("link", { name: "Northwind round 2" })).toHaveAttribute(
    "href",
    "/activity?share=s1",
  );
});

test("events can be filtered by type", async () => {
  const user = userEvent.setup();
  const api = setup();
  renderRoute("/activity");

  const filters = await screen.findByRole("navigation", { name: "Filter by event" });
  await user.click(within(filters).getByRole("link", { name: "Sign-ins & passwords" }));

  await screen.findByRole("table");
  const last = activityRequests(api).at(-1);
  expect(last?.searchParams.getAll("kind")).toEqual([
    "login_succeeded",
    "login_failed",
    "unlock_failed",
  ]);
  expect(within(filters).getByRole("link", { name: "Sign-ins & passwords" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("a link's own activity can be shown, and the filter removed", async () => {
  const user = userEvent.setup();
  const api = setup();
  renderRoute("/activity?share=s1");

  expect(await screen.findByText("Only “Northwind round 2”")).toBeInTheDocument();
  expect(activityRequests(api)[0]?.searchParams.get("share_id")).toBe("s1");

  await user.click(screen.getByRole("link", { name: "Show activity for all links" }));

  expect(screen.queryByText(/Only “/)).not.toBeInTheDocument();
  expect(activityRequests(api).at(-1)?.searchParams.get("share_id")).toBeNull();
});

test("older events load on demand", async () => {
  const user = userEvent.setup();
  const api = setup((url) =>
    url.searchParams.get("cursor")
      ? json({ events: [event("old", { kind: "share_revoked" })], next_cursor: null })
      : json({ events: EVENTS, next_cursor: "next" }),
  );
  renderRoute("/activity");

  await user.click(await screen.findByRole("button", { name: "Load more" }));

  expect(await screen.findByRole("cell", { name: "Link revoked" })).toBeInTheDocument();
  expect(activityRequests(api).at(-1)?.searchParams.get("cursor")).toBe("next");
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
});

test("an empty log explains what will appear", async () => {
  setup(() => json({ events: [], next_cursor: null }));
  renderRoute("/activity");

  expect(await screen.findByText("No activity yet")).toBeInTheDocument();
});

test("each link on the Shares page leads to its activity", async () => {
  const user = userEvent.setup();
  setup();
  const { router } = renderRoute("/shares");

  await user.click(await screen.findByRole("button", { name: "Actions for Northwind round 2" }));
  await user.click(screen.getByRole("menuitem", { name: "View activity" }));

  expect(router.state.location.pathname).toBe("/activity");
  expect(router.state.location.search).toBe("?share=s1");
  expect(await screen.findByText("Only “Northwind round 2”")).toBeInTheDocument();
});
