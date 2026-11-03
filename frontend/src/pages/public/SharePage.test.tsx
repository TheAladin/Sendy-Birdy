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

const LOCKED = () =>
  json({ detail: { reason: "locked", message: "", shared_by: "Alex Martin" } }, 403);

/** A server that stays locked until the unlock endpoint accepts "blue heron". */
function lockedServer(unlockAnswer?: (password: string) => Response | undefined) {
  let unlocked = false;
  const api = mockApi({
    [`GET ${PATH}`]: () => (unlocked ? json(SHARE) : LOCKED()),
    [`POST ${PATH}/unlock`]: async (request) => {
      const { password } = (await request.json()) as { password: string };
      const special = unlockAnswer?.(password);
      if (special) return special;
      if (password !== "blue heron") return json({ detail: "That password isn't right." }, 401);
      unlocked = true;
      return new Response(null, { status: 204 });
    },
  });
  return api;
}

test("a locked link asks for the password, and opens with the right one", async () => {
  const user = userEvent.setup();
  const api = lockedServer();
  renderRoute(`/s/${TOKEN}`);

  expect(
    await screen.findByRole("heading", { name: "This link is protected by a password" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Alex Martin added a password/)).toBeInTheDocument();
  // Nothing about the share itself is shown before unlocking.
  expect(screen.queryByText("Homepage redesign: round 2")).not.toBeInTheDocument();
  const field = screen.getByLabelText("Password");
  expect(field).toHaveFocus();
  expect(field).toHaveAttribute("type", "password");

  await user.type(field, "grey heron{Enter}");
  expect(await screen.findByText(/That password isn't right/)).toBeInTheDocument();
  expect(field).toHaveAccessibleDescription(
    "That password isn't right. Ask Alex Martin to check it.",
  );

  await user.clear(field);
  await user.type(field, "blue heron{Enter}");

  expect(
    await screen.findByRole("heading", { level: 1, name: "Homepage redesign: round 2" }),
  ).toBeInTheDocument();
  const requests = api.mock.calls.map(([r]) => r as Request);
  expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
    `GET ${PATH}`,
    `POST ${PATH}/unlock`,
    `POST ${PATH}/unlock`,
    `GET ${PATH}`,
  ]);
  // The page sends the CSRF header like every other request.
  expect(requests[1]?.headers.get("X-Requested-With")).toBe("fetch");
});

test("an empty password isn't sent", async () => {
  const user = userEvent.setup();
  const api = lockedServer();
  renderRoute(`/s/${TOKEN}`);

  await user.click(await screen.findByRole("button", { name: "Open" }));

  expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Enter the password.");
  expect(api).toHaveBeenCalledTimes(1);
});

test("the password can be shown while typing", async () => {
  const user = userEvent.setup();
  lockedServer();
  renderRoute(`/s/${TOKEN}`);

  await user.click(await screen.findByRole("button", { name: "Show password" }));

  expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("too many attempts blocks the form until the wait is over", async () => {
  const user = userEvent.setup();
  lockedServer(() => json({ detail: "Too many attempts" }, 429, { "Retry-After": "2" }));
  renderRoute(`/s/${TOKEN}`);

  await user.type(await screen.findByLabelText("Password"), "guess{Enter}");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Too many attempts. Try again in 2 seconds.",
  );
  const open = screen.getByRole("button", { name: "Open" });
  expect(open).toBeDisabled();
  // The countdown ends and the form works again.
  await waitFor(() => expect(open).toBeEnabled(), { timeout: 4000 });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a link revoked while the form is open says so", async () => {
  const user = userEvent.setup();
  let revoked = false;
  mockApi({
    [`GET ${PATH}`]: () =>
      revoked ? json({ detail: { reason: "revoked", message: "" } }, 410) : LOCKED(),
    [`POST ${PATH}/unlock`]: () => {
      revoked = true;
      return json({ detail: { reason: "revoked", message: "" } }, 410);
    },
  });
  renderRoute(`/s/${TOKEN}`);

  await user.type(await screen.findByLabelText("Password"), "blue heron{Enter}");

  expect(
    await screen.findByRole("heading", { name: "This link is no longer available" }),
  ).toBeInTheDocument();
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
