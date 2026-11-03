import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import type { ItemSummary } from "../api/items";
import type { ShareOut, ShareSummary, ShareUpdate } from "../api/shares";
import { json, LIMITS, mockApi } from "../test/api";
import { renderRoute } from "../test/render";

const USER = { id: "u1", email: "me@example.com", display_name: "Alex" };
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const at = (offset: number) => new Date(Date.now() + offset).toISOString();

function share(id: string, title: string, overrides: Partial<ShareSummary> = {}): ShareSummary {
  return {
    id,
    title,
    url: `https://share.example.com/s/${id}-token`,
    status: "active",
    expires_at: at(7 * DAY),
    revoked_at: null,
    allow_downloads: true,
    has_password: false,
    view_count: 0,
    last_viewed_at: null,
    item_count: 2,
    created_at: at(-DAY),
    updated_at: at(-DAY),
    ...overrides,
  };
}

const ACTIVE = share("s1", "Northwind round 2", {
  view_count: 3,
  last_viewed_at: at(-2 * HOUR),
});
const EXPIRING = share("s2", "Logo options", { expires_at: at(10 * HOUR), has_password: true });
const EXPIRED = share("s3", "Old mockups", { status: "expired", expires_at: at(-2 * DAY) });
const REVOKED = share("s4", "Wrong client", { status: "revoked", revoked_at: at(-DAY) });
const ALL = [ACTIVE, EXPIRING, EXPIRED, REVOKED];

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(shares: ShareSummary[] = ALL, extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items/upload-limits": () => json(LIMITS),
    "GET /api/shares": () => json(shares),
    ...extra,
  });
}

const row = (title: string) =>
  screen.getByRole("heading", { name: title }).closest("li") as HTMLElement;

const sent = (spy: ReturnType<typeof mockApi>, method: string) =>
  spy.mock.calls.map(([request]) => request as Request).filter((r) => r.method === method);

test("each link's status is clear at a glance", async () => {
  setup();
  renderRoute("/shares");

  await screen.findByRole("heading", { name: "Northwind round 2" });
  expect(within(row("Northwind round 2")).getByText("Active")).toBeInTheDocument();
  expect(row("Northwind round 2")).toHaveTextContent("2 items·3 views, last 2 hours ago");
  expect(row("Northwind round 2")).toHaveTextContent("Expires in 7 days");

  expect(within(row("Logo options")).getByText("Expiring soon")).toBeInTheDocument();
  expect(within(row("Logo options")).getByText("Password protected")).toBeInTheDocument();
  expect(row("Logo options")).toHaveTextContent("Expires in 10 hours");
  expect(row("Logo options")).toHaveTextContent("Not viewed yet");

  expect(within(row("Old mockups")).getByText("Expired")).toBeInTheDocument();
  expect(row("Old mockups")).toHaveTextContent("Expired 2 days ago");

  expect(within(row("Wrong client")).getByText("Revoked")).toBeInTheDocument();
  expect(row("Wrong client")).toHaveTextContent("Revoked yesterday");
  // A revoked link is dead: nothing to copy or open.
  expect(
    within(row("Wrong client")).queryByRole("button", { name: /Copy link/ }),
  ).not.toBeInTheDocument();
  expect(
    within(row("Northwind round 2")).getByRole("link", { name: "Open Northwind round 2" }),
  ).toHaveAttribute("href", ACTIVE.url);
});

test("links can be filtered by status", async () => {
  const user = userEvent.setup();
  setup();
  renderRoute("/shares");

  const filters = await screen.findByRole("navigation", { name: "Filter by status" });
  expect(within(filters).getByRole("link", { name: "Active 2" })).toBeInTheDocument();
  await user.click(within(filters).getByRole("link", { name: "Expired 1" }));

  expect(screen.getByRole("heading", { name: "Old mockups" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Northwind round 2" })).not.toBeInTheDocument();
  expect(within(filters).getByRole("link", { name: "Expired 1" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("a link can be copied", async () => {
  const user = userEvent.setup();
  setup();
  renderRoute("/shares");

  await user.click(await screen.findByRole("button", { name: "Copy link for Northwind round 2" }));

  expect(await screen.findByText("Link copied")).toBeInTheDocument();
  expect(await navigator.clipboard.readText()).toBe(ACTIVE.url);
});

test("revoking asks first, then revokes", async () => {
  const user = userEvent.setup();
  const api = setup(ALL, {
    "POST /api/shares/s1/revoke": () => json({ ...ACTIVE, status: "revoked", items: [] }),
  });
  renderRoute("/shares");

  await user.click(await screen.findByRole("button", { name: "Actions for Northwind round 2" }));
  await user.click(screen.getByRole("menuitem", { name: "Revoke" }));
  const dialog = screen.getByRole("dialog", { name: 'Revoke "Northwind round 2"?' });
  expect(dialog).toHaveTextContent("can't be turned back on");
  await user.click(within(dialog).getByRole("button", { name: "Revoke link" }));

  expect(await screen.findByText('Revoked "Northwind round 2"')).toBeInTheDocument();
  expect(sent(api, "POST")).toHaveLength(1);
});

test("deleting asks first, then deletes; a revoked link can only be deleted", async () => {
  const user = userEvent.setup();
  const api = setup(ALL, { "DELETE /api/shares/s4": () => new Response(null, { status: 204 }) });
  renderRoute("/shares");

  await user.click(await screen.findByRole("button", { name: "Actions for Wrong client" }));
  // Its history is still worth seeing, but there's nothing left to edit or revoke.
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "View activity",
    "Delete",
  ]);
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));
  const dialog = screen.getByRole("dialog", { name: 'Delete "Wrong client"?' });
  expect(dialog).toHaveTextContent("The items stay in your library.");
  await user.click(within(dialog).getByRole("button", { name: "Delete link" }));

  expect(await screen.findByText('Deleted "Wrong client"')).toBeInTheDocument();
  expect(new URL(sent(api, "DELETE")[0]?.url ?? "").pathname).toBe("/api/shares/s4");
});

test("an expired link can be brought back with a new expiry", async () => {
  const user = userEvent.setup();
  const api = setup(ALL, {
    "PATCH /api/shares/s3": () => json({ ...EXPIRED, status: "active", items: [] }),
  });
  renderRoute("/shares");

  await user.click(await screen.findByRole("button", { name: "Actions for Old mockups" }));
  await user.click(screen.getByRole("menuitem", { name: "Reactivate…" }));
  const dialog = screen.getByRole("dialog", { name: 'Change expiry for "Old mockups"' });
  expect(dialog).toHaveTextContent("The link starts working again.");
  await user.click(within(dialog).getByRole("radio", { name: "30 days" }));
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Expiry changed")).toBeInTheDocument();
  const body = (await sent(api, "PATCH")[0]?.json()) as ShareUpdate;
  expect(Object.keys(body)).toEqual(["expires_at"]);
  expect(Math.abs(new Date(body.expires_at ?? 0).getTime() - (Date.now() + 30 * DAY))).toBeLessThan(
    60_000,
  );
});

const ITEMS: ItemSummary[] = ["a", "b"].map((id) => ({
  id,
  kind: "image",
  title: id === "a" ? "Homepage" : "Pricing",
  original_filename: `${id}.png`,
  mime_type: "image/png",
  size_bytes: 1000,
  width: 100,
  height: 100,
  duration_s: null,
  has_thumbnail: true,
  share_count: 1,
  created_at: at(-DAY),
  updated_at: at(-DAY),
  excerpt: null,
}));
const FULL: ShareOut = { ...EXPIRING, message: "Hi!", items: ITEMS };

test("editing loads the link, keeps what isn't changed, and saves", async () => {
  const user = userEvent.setup();
  const api = setup(ALL, {
    "GET /api/shares/s2": () => json(FULL),
    "PATCH /api/shares/s2": () => json({ ...FULL, title: "Logo options v2" }),
  });
  renderRoute("/shares");

  await user.click(await screen.findByRole("button", { name: "Actions for Logo options" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit link" });
  expect(within(dialog).getByLabelText("Title")).toHaveValue("Logo options");
  expect(within(dialog).getByLabelText("Message (optional)")).toHaveValue("Hi!");
  expect(within(dialog).getByRole("radio", { name: "Keep" })).toBeChecked();
  expect(within(dialog).getByRole("checkbox", { name: "Require a password" })).toBeChecked();
  expect(within(dialog).getByLabelText("New password")).toHaveValue("");

  await user.clear(within(dialog).getByLabelText("Title"));
  await user.type(within(dialog).getByLabelText("Title"), "Logo options v2");
  await user.click(within(dialog).getByRole("button", { name: "Move Pricing up" }));
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Link updated")).toBeInTheDocument();
  // No expiry and no password sent: both stay as they were.
  expect(await sent(api, "PATCH")[0]?.json()).toEqual({
    title: "Logo options v2",
    item_ids: ["b", "a"],
    message: "Hi!",
    allow_downloads: true,
  });
});

test("editing can remove or replace a password", async () => {
  const user = userEvent.setup();
  const api = setup(ALL, {
    "GET /api/shares/s2": () => json(FULL),
    "PATCH /api/shares/s2": () => json(FULL),
  });
  renderRoute("/shares");

  await user.click(await screen.findByRole("button", { name: "Actions for Logo options" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit" }));
  let dialog = await screen.findByRole("dialog", { name: "Edit link" });
  await user.type(within(dialog).getByLabelText("New password"), "green heron");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(sent(api, "PATCH")).toHaveLength(1));
  expect(await sent(api, "PATCH")[0]?.json()).toMatchObject({ password: "green heron" });

  await user.click(screen.getByRole("button", { name: "Actions for Logo options" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit" }));
  dialog = await screen.findByRole("dialog", { name: "Edit link" });
  await user.click(within(dialog).getByRole("checkbox", { name: "Require a password" }));
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(sent(api, "PATCH")).toHaveLength(2));
  expect(await sent(api, "PATCH")[1]?.json()).toMatchObject({ password: null });
});

test("with no links yet, the page explains how to make one", async () => {
  setup([]);
  renderRoute("/shares");

  expect(await screen.findByText("No share links yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to the library" })).toHaveAttribute("href", "/");
  expect(screen.queryByRole("navigation", { name: "Filter by status" })).not.toBeInTheDocument();
});

test("deleting a shared item lists the links that will lose it", async () => {
  const user = userEvent.setup();
  const unshared = { ...ITEMS[1], id: "c", title: "Draft", share_count: 0 };
  const api = mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items/upload-limits": () => json(LIMITS),
    "GET /api/items": () => json({ items: [ITEMS[0], unshared], next_cursor: null }),
    "GET /api/shares": () => json([ACTIVE, EXPIRED]),
  });
  renderRoute("/");

  // An item in no link: nothing to warn about, and no request.
  await user.click(await screen.findByRole("button", { name: "Actions for Draft" }));
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(screen.getByRole("dialog")).not.toHaveTextContent("will lose");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("button", { name: "Actions for Homepage" }));
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));
  const dialog = screen.getByRole("dialog", { name: 'Delete "Homepage"?' });

  expect(await within(dialog).findByText("These 2 links will lose it:")).toBeInTheDocument();
  expect(dialog).toHaveTextContent("Northwind round 2 (active)");
  expect(dialog).toHaveTextContent("Old mockups (expired)");
  const asked = sent(api, "GET").filter((r) => new URL(r.url).pathname === "/api/shares");
  expect(asked.map((r) => new URL(r.url).searchParams.getAll("item_id"))).toEqual([["a"]]);
});
