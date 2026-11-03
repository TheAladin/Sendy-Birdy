import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { json, LIMITS, mockApi } from "../../test/api";
import { renderRoute } from "../../test/render";

const USER = { id: "u1", email: "me@example.com", display_name: "Alex" };
const NOTE = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "note",
  title: "Release notes",
  body: "# v2.3\n\n- Apple Pay",
  excerpt: "v2.3 Apple Pay",
  original_filename: null,
  mime_type: null,
  size_bytes: null,
  width: null,
  height: null,
  duration_s: null,
  has_thumbnail: false,
  share_count: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items": () => json({ items: [NOTE], next_cursor: null }),
    "GET /api/items/upload-limits": () => json(LIMITS),
    ...extra,
  });
}

const requestsTo = (spy: ReturnType<typeof mockApi>, method: string) =>
  spy.mock.calls.map(([r]) => r as Request).filter((r) => r.method === method);

test("a new note can be written, previewed and created", async () => {
  const user = userEvent.setup();
  const api = setup({
    "POST /api/items/notes": () => json({ ...NOTE, id: "new", title: "Round 2" }, 201),
  });
  renderRoute("/");

  await user.click(await screen.findByRole("button", { name: "New note" }));
  const dialog = screen.getByRole("dialog", { name: "New note" });
  await user.type(within(dialog).getByLabelText("Title"), "Round 2");
  await user.type(
    within(dialog).getByLabelText("Markdown"),
    "# Changes{enter}{enter}- **Faster** checkout",
  );

  await user.click(within(dialog).getByRole("tab", { name: "Preview" }));
  expect(within(dialog).getByRole("heading", { name: "Changes" })).toBeVisible();
  expect(within(dialog).getByText("Faster").tagName).toBe("STRONG");

  await user.click(within(dialog).getByRole("button", { name: "Create note" }));

  expect(await screen.findByText("Note created")).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "New note" })).not.toBeInTheDocument();
  expect(await requestsTo(api, "POST")[0]?.json()).toEqual({
    title: "Round 2",
    body: "# Changes\n\n- **Faster** checkout",
  });
});

test("editing loads the full text and saves changes", async () => {
  const user = userEvent.setup();
  const api = setup({
    [`GET /api/items/${NOTE.id}`]: () => json(NOTE),
    [`PATCH /api/items/${NOTE.id}`]: () => json({ ...NOTE, body: "# v2.4" }),
  });
  renderRoute("/");

  await user.click(await screen.findByRole("button", { name: "Edit Release notes" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit note" });
  const textarea = await within(dialog).findByLabelText("Markdown");
  expect(textarea).toHaveValue(NOTE.body);

  await user.clear(textarea);
  await user.type(textarea, "# v2.4");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Note saved")).toBeInTheDocument();
  expect(await requestsTo(api, "PATCH")[0]?.json()).toEqual({
    title: "Release notes",
    body: "# v2.4",
  });
});

test("empty and oversized notes are caught before saving", async () => {
  const user = userEvent.setup();
  const api = setup();
  renderRoute("/");
  await user.click(await screen.findByRole("button", { name: "New note" }));
  const dialog = screen.getByRole("dialog", { name: "New note" });

  await user.click(within(dialog).getByRole("button", { name: "Create note" }));
  expect(within(dialog).getByLabelText("Title")).toHaveAccessibleDescription(
    "Give the note a title.",
  );
  expect(within(dialog).getByLabelText("Markdown")).toBeInvalid();

  await user.type(within(dialog).getByLabelText("Title"), "Huge");
  await user.click(within(dialog).getByLabelText("Markdown"));
  await user.paste("é".repeat(51_201));
  expect(within(dialog).getByText("100 KB of 100 KB")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Create note" }));
  expect(within(dialog).getByText("A note can be at most 100 KB.")).toBeInTheDocument();
  expect(requestsTo(api, "POST")).toHaveLength(0);
});

test("a server error is shown in the editor", async () => {
  const user = userEvent.setup();
  setup({
    "POST /api/items/notes": () =>
      json({ detail: [{ msg: "Value error, A note can be at most 100 KB." }] }, 422),
  });
  renderRoute("/");
  await user.click(await screen.findByRole("button", { name: "New note" }));
  const dialog = screen.getByRole("dialog", { name: "New note" });
  await user.type(within(dialog).getByLabelText("Title"), "Notes");
  await user.type(within(dialog).getByLabelText("Markdown"), "Text");

  await user.click(within(dialog).getByRole("button", { name: "Create note" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "A note can be at most 100 KB.",
  );
});

test("closing with unsaved changes asks first", async () => {
  const user = userEvent.setup();
  setup();
  renderRoute("/");
  await user.click(await screen.findByRole("button", { name: "New note" }));
  const dialog = screen.getByRole("dialog", { name: "New note" });
  await user.type(within(dialog).getByLabelText("Title"), "Draft");

  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("You have unsaved changes.");
  await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
  expect(within(dialog).getByLabelText("Title")).toHaveValue("Draft");

  // Esc goes through the same check.
  dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  await user.click(await within(dialog).findByRole("button", { name: "Discard changes" }));

  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "New note" })).not.toBeInTheDocument(),
  );
});

test("closing an untouched editor needs no confirmation", async () => {
  const user = userEvent.setup();
  setup();
  renderRoute("/");
  await user.click(await screen.findByRole("button", { name: "New note" }));

  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog", { name: "New note" })).not.toBeInTheDocument();
});

test("the Write and Preview tabs work with the arrow keys", async () => {
  const user = userEvent.setup();
  setup();
  renderRoute("/");
  await user.click(await screen.findByRole("button", { name: "New note" }));
  const write = screen.getByRole("tab", { name: "Write" });

  write.focus();
  await user.keyboard("{ArrowRight}");

  const preview = screen.getByRole("tab", { name: "Preview" });
  expect(preview).toHaveFocus();
  expect(preview).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("Nothing to preview yet.")).toBeVisible();
});
