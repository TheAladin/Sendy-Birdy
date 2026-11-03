import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import type { PublicItem, PublicShare } from "../../api/public";
import { json, mockApi } from "../../test/api";
import { renderRoute } from "../../test/render";

const TOKEN = "k03e1YFUPybJ37a5pAPq3g";
const PATH = `/api/public/shares/${TOKEN}`;

function item(id: string, overrides: Partial<PublicItem>): PublicItem {
  return {
    id,
    kind: "image",
    title: id,
    mime_type: "image/png",
    size_bytes: 33_000,
    width: 1440,
    height: 900,
    duration_s: null,
    has_thumbnail: true,
    body: null,
    ...overrides,
  };
}

const SHARE: PublicShare = {
  title: "Homepage redesign: round 2",
  message: "Hi! Here are the **updated screens**.",
  shared_by: "Alex Martin",
  expires_at: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
  allow_downloads: true,
  items: [
    item("desktop", { title: "Desktop" }),
    item("walkthrough", {
      title: "Checkout walkthrough",
      kind: "video",
      mime_type: "video/mp4",
      duration_s: 42,
    }),
    item("notes", {
      title: "What changed",
      kind: "note",
      mime_type: null,
      size_bytes: null,
      has_thumbnail: false,
      body: "## Changes\n\n- Shorter hero",
    }),
    item("mobile", { title: "Mobile" }),
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(answer: () => Response = () => json(SHARE)) {
  return mockApi({ [`GET ${PATH}`]: answer });
}

test("the share shows its title, sender, expiry, message and items in order", async () => {
  const api = setup();
  renderRoute(`/s/${TOKEN}`);

  expect(
    await screen.findByRole("heading", { level: 1, name: "Homepage redesign: round 2" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Shared by Alex Martin/)).toHaveTextContent("(in 6 days)");
  expect(
    within(screen.getByRole("region", { name: "Message" })).getByText("updated screens"),
  ).toHaveProperty("tagName", "STRONG");
  await waitFor(() => expect(document.title).toBe("Homepage redesign: round 2 · Sendy Birdy"));

  // The gallery's own entries (a note's Markdown list has list items too).
  const gallery = within(screen.getByRole("region", { name: "Shared items" })).getAllByRole(
    "list",
  )[0];
  const items = Array.from(gallery?.children ?? []);
  expect(items.map((li) => li.textContent)).toEqual([
    expect.stringContaining("Desktop"),
    expect.stringContaining("Checkout walkthrough"),
    expect.stringContaining("What changed"),
    expect.stringContaining("Mobile"),
  ]);

  // Images: a thumbnail that opens full size.
  expect(screen.getByRole("button", { name: "View Desktop full size" })).toBeInTheDocument();
  // Videos: a poster, and nothing downloaded until play.
  const video = screen.getByLabelText("Checkout walkthrough");
  expect(video).toHaveAttribute("src", `${PATH}/items/walkthrough/file`);
  expect(video).toHaveAttribute("poster", `${PATH}/items/walkthrough/thumbnail`);
  expect(video).toHaveAttribute("preload", "none");
  expect(items[1]).toHaveTextContent("0:42");
  // Notes: the full text, formatted.
  expect(screen.getByRole("heading", { level: 2, name: "Changes" })).toBeInTheDocument();

  // Downloads for files, not notes.
  expect(screen.getByRole("link", { name: "Download Desktop" })).toHaveAttribute(
    "href",
    `${PATH}/items/desktop/file?download=1`,
  );
  expect(screen.getAllByRole("link", { name: /^Download/ })).toHaveLength(3);

  // Only the share was asked for: no admin endpoints, and only once (each load is a view).
  expect(api.mock.calls.map(([r]) => new URL((r as Request).url).pathname)).toEqual([PATH]);
});

test("without downloads, there are no download links", async () => {
  setup(() => json({ ...SHARE, allow_downloads: false }));
  renderRoute(`/s/${TOKEN}`);

  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByRole("link", { name: /Download/ })).not.toBeInTheDocument();
});

test("images open full size, and the arrow keys move between images only", async () => {
  const user = userEvent.setup();
  setup();
  renderRoute(`/s/${TOKEN}`);

  const open = await screen.findByRole("button", { name: "View Desktop full size" });
  await user.click(open);
  const viewer = screen.getByRole("dialog", { name: "Desktop" });
  expect(within(viewer).getByRole("img", { name: "Desktop" })).toHaveAttribute(
    "src",
    `${PATH}/items/desktop/file`,
  );
  expect(within(viewer).getByText("1 of 2")).toBeInTheDocument();
  expect(within(viewer).getByRole("link", { name: "Download" })).toHaveAttribute(
    "href",
    `${PATH}/items/desktop/file?download=1`,
  );

  // The video and the note are skipped: the next image is "Mobile".
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("dialog", { name: "Mobile" })).toBeInTheDocument();

  screen.getByRole("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(open).toHaveFocus();
});

test.each([
  [404, { detail: "Not found." }, "This link doesn't exist"],
  [410, { detail: { reason: "expired", message: "" } }, "This link has expired"],
  [410, { detail: { reason: "revoked", message: "" } }, "This link is no longer available"],
])("a %i answer explains what happened", async (status, body, heading) => {
  const api = setup(() => json(body, status));
  renderRoute(`/s/${TOKEN}`);

  expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  // A gone link won't come back by asking again.
  expect(api).toHaveBeenCalledTimes(1);
});

test("a locked link says who to ask for the password", async () => {
  setup(() => json({ detail: { reason: "locked", message: "", shared_by: "Alex Martin" } }, 403));
  renderRoute(`/s/${TOKEN}`);

  expect(
    await screen.findByRole("heading", { name: "This link is protected by a password" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Alex Martin added a password/)).toBeInTheDocument();
});

test("a network failure can be retried", { timeout: 10_000 }, async () => {
  const user = userEvent.setup();
  let fail = true;
  setup(() => (fail ? json({ detail: "Bad gateway" }, 502) : json(SHARE)));
  renderRoute(`/s/${TOKEN}`);

  // Network trouble is retried twice (after 1 s, then 2 s) before the page gives up.
  expect(
    await screen.findByRole("heading", { name: "This page couldn't be loaded" }, { timeout: 5000 }),
  ).toBeInTheDocument();
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));

  expect(
    await screen.findByRole("heading", { level: 1, name: "Homepage redesign: round 2" }),
  ).toBeInTheDocument();
});

test("a link whose items were all deleted says so", async () => {
  setup(() => json({ ...SHARE, items: [] }));
  renderRoute(`/s/${TOKEN}`);

  expect(await screen.findByText("There's nothing in this link anymore.")).toBeInTheDocument();
});

test("a note's title isn't repeated when the note starts with it", async () => {
  setup(() =>
    json({
      ...SHARE,
      items: [
        item("a", { kind: "note", title: "Changelog", body: "# Changelog\n\nText" }),
        item("b", { kind: "note", title: "Ideas", body: "First, ..." }),
      ],
    }),
  );
  renderRoute(`/s/${TOKEN}`);

  expect(await screen.findAllByRole("heading", { name: "Changelog" })).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Ideas" })).toBeInTheDocument();
});
