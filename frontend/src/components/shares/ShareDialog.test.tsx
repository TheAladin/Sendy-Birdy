import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import type { ItemSummary } from "../../api/items";
import type { ShareCreate, ShareOut } from "../../api/shares";
import { json, LIMITS, mockApi } from "../../test/api";
import { renderRoute } from "../../test/render";

const USER = { id: "u1", email: "me@example.com", display_name: "Alex" };
const DAY = 24 * 3600 * 1000;

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

const ITEMS = [item("a", "Homepage"), item("b", "Pricing page"), item("c", "Checkout")];
const URL_ = "https://share.example.com/s/k03e1YFUPybJ37a5pAPq3g";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The fake server answers a create with what was sent, like the real one. */
function setup(answer?: () => Response) {
  const sent: ShareCreate[] = [];
  mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items": () => json({ items: ITEMS, next_cursor: null }),
    "GET /api/items/upload-limits": () => json(LIMITS),
    "POST /api/shares": async (request) => {
      const body = (await request.json()) as ShareCreate;
      sent.push(body);
      if (answer) return answer();
      const share: ShareOut = {
        id: "s1",
        url: URL_,
        title: body.title,
        message: body.message ?? null,
        status: "active",
        expires_at: body.expires_at ?? null,
        revoked_at: null,
        allow_downloads: body.allow_downloads ?? true,
        has_password: Boolean(body.password),
        view_count: 0,
        last_viewed_at: null,
        item_count: body.item_ids.length,
        items: ITEMS.filter((other) => body.item_ids.includes(other.id)),
        created_at: "2026-11-03T10:00:00Z",
        updated_at: "2026-11-03T10:00:00Z",
      };
      return json(share, 201);
    },
  });
  return sent;
}

async function shareSelection(user: ReturnType<typeof userEvent.setup>, titles: string[]) {
  renderRoute("/");
  await user.click(await screen.findByRole("button", { name: "Select" }));
  for (const title of titles) {
    await user.click(screen.getByRole("checkbox", { name: `Select ${title}` }));
  }
  await user.click(
    within(screen.getByRole("region", { name: "Selection" })).getByRole("button", {
      name: "Share",
    }),
  );
  return screen.getByRole("dialog", { name: "Share" });
}

test("the quick path: select, Share, Enter, and the link is copied", async () => {
  const user = userEvent.setup();
  const sent = setup();
  const dialog = await shareSelection(user, ["Homepage", "Checkout"]);

  // The title is suggested and focused, so Enter is enough.
  const title = within(dialog).getByLabelText("Title");
  expect(title).toHaveValue("Homepage and 1 more");
  expect(title).toHaveFocus();
  await user.keyboard("{Enter}");

  const ready = await screen.findByRole("dialog", { name: "Link ready" });
  expect(within(ready).getByLabelText("Link")).toHaveValue(URL_);
  expect(await within(ready).findByRole("status")).toHaveTextContent("ready to paste");
  expect(await navigator.clipboard.readText()).toBe(URL_);
  expect(within(ready).getByRole("button", { name: "Copied" })).toHaveFocus();
  expect(within(ready).getByRole("link", { name: "Open" })).toHaveAttribute("href", URL_);
  // Selection mode is over once the link exists.
  expect(screen.queryByRole("region", { name: "Selection" })).not.toBeInTheDocument();

  const [body] = sent;
  expect(body).toMatchObject({
    title: "Homepage and 1 more",
    item_ids: ["a", "c"],
    message: null,
    allow_downloads: true,
    password: null,
  });
  // Seven days by default.
  const expires = new Date(body?.expires_at ?? 0).getTime();
  expect(Math.abs(expires - (Date.now() + 7 * DAY))).toBeLessThan(60_000);
  expect(within(ready).getByText(/2 items · expires/)).toBeInTheDocument();

  await user.click(within(ready).getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("items can be reordered and removed before sharing", async () => {
  const user = userEvent.setup();
  const sent = setup();
  const dialog = await shareSelection(user, ["Homepage", "Pricing page", "Checkout"]);

  const down = within(dialog).getByRole("button", { name: "Move Homepage down" });
  await user.click(down);
  expect(within(dialog).getByText("Homepage moved to position 2 of 3.")).toBeInTheDocument();
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Move Homepage down" })).toHaveFocus(),
  );
  expect(within(dialog).getByRole("button", { name: "Move Pricing page up" })).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "Remove Checkout" }));

  await user.click(within(dialog).getByRole("button", { name: "Create link" }));

  await screen.findByRole("dialog", { name: "Link ready" });
  expect(sent[0]?.item_ids).toEqual(["b", "a"]);
});

test("the last item can't be removed", async () => {
  const user = userEvent.setup();
  setup();
  const dialog = await shareSelection(user, ["Homepage"]);

  expect(within(dialog).getByRole("button", { name: "Remove Homepage" })).toBeDisabled();
});

test("message, expiry, password and downloads are sent as chosen", async () => {
  const user = userEvent.setup();
  const sent = setup();
  const dialog = await shareSelection(user, ["Pricing page"]);

  await user.type(within(dialog).getByLabelText("Message (optional)"), "Hi! **Round 2**");
  await user.click(within(dialog).getByRole("radio", { name: "30 days" }));
  await user.click(within(dialog).getByRole("checkbox", { name: "Require a password" }));
  await user.type(within(dialog).getByLabelText("Password"), "blue heron");
  await user.click(within(dialog).getByRole("checkbox", { name: "Allow downloads" }));
  await user.click(within(dialog).getByRole("button", { name: "Create link" }));

  const ready = await screen.findByRole("dialog", { name: "Link ready" });
  expect(sent[0]).toMatchObject({
    title: "Pricing page",
    message: "Hi! **Round 2**",
    password: "blue heron",
    allow_downloads: false,
  });
  const expires = new Date(sent[0]?.expires_at ?? 0).getTime();
  expect(Math.abs(expires - (Date.now() + 30 * DAY))).toBeLessThan(60_000);
  expect(within(ready).getByText(/password protected · downloads off/)).toBeInTheDocument();
  // A reminder of the password, to send separately.
  expect(within(ready).getByText("blue heron")).toBeInTheDocument();
});

test("a link can last forever", async () => {
  const user = userEvent.setup();
  const sent = setup();
  const dialog = await shareSelection(user, ["Homepage"]);

  await user.click(within(dialog).getByRole("radio", { name: "Never" }));
  expect(within(dialog).getByText("Works until you revoke it.")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Create link" }));

  await screen.findByRole("dialog", { name: "Link ready" });
  expect(sent[0]?.expires_at).toBeNull();
});

test("a picked date must be given, and lasts through that day", async () => {
  const user = userEvent.setup();
  const sent = setup();
  const dialog = await shareSelection(user, ["Homepage"]);

  await user.click(within(dialog).getByRole("radio", { name: "Pick a date" }));
  await user.click(within(dialog).getByRole("button", { name: "Create link" }));
  expect(within(dialog).getByLabelText("Last day")).toHaveAccessibleDescription(
    "Pick the last day the link works.",
  );
  expect(sent).toHaveLength(0);

  await user.type(within(dialog).getByLabelText("Last day"), "2099-05-20");
  await user.click(within(dialog).getByRole("button", { name: "Create link" }));

  await screen.findByRole("dialog", { name: "Link ready" });
  expect(new Date(sent[0]?.expires_at ?? 0)).toEqual(new Date(2099, 4, 20, 23, 59, 59));
});

test("a too-short password or empty title is caught before sending", async () => {
  const user = userEvent.setup();
  const sent = setup();
  const dialog = await shareSelection(user, ["Homepage"]);

  await user.clear(within(dialog).getByLabelText("Title"));
  await user.click(within(dialog).getByRole("checkbox", { name: "Require a password" }));
  await user.type(within(dialog).getByLabelText("Password"), "abc");
  await user.click(within(dialog).getByRole("button", { name: "Create link" }));

  expect(within(dialog).getByText("Give the link a title.")).toBeInTheDocument();
  expect(within(dialog).getByText("Use at least 4 characters.")).toBeInTheDocument();
  expect(sent).toHaveLength(0);
});

test("a server error is shown in the dialog", async () => {
  const user = userEvent.setup();
  setup(() =>
    json(
      { detail: "Some of these items no longer exist. Refresh the library and try again." },
      422,
    ),
  );
  const dialog = await shareSelection(user, ["Homepage"]);

  await user.keyboard("{Enter}");

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("no longer exist");
});

test("a single item can be shared from its menu", async () => {
  const user = userEvent.setup();
  const sent = setup();
  renderRoute("/");

  await user.click(await screen.findByRole("button", { name: "Actions for Checkout" }));
  await user.click(screen.getByRole("menuitem", { name: "Share…" }));
  const dialog = screen.getByRole("dialog", { name: "Share" });
  expect(within(dialog).getByLabelText("Title")).toHaveValue("Checkout");
  await user.keyboard("{Enter}");

  await screen.findByRole("dialog", { name: "Link ready" });
  expect(sent[0]?.item_ids).toEqual(["c"]);
});
