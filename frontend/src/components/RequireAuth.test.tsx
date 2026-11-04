import { screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { json, LIMITS, mockApi } from "../test/api";
import { renderRoute } from "../test/render";

const USER = { id: "u1", email: "me@example.com", display_name: "Alex" };

afterEach(() => {
  vi.restoreAllMocks();
});

const requested = (api: ReturnType<typeof mockApi>, path: string) =>
  api.mock.calls.some(([request]) => new URL((request as Request).url).pathname === path);

test("the page's own requests start while the session is still being checked", async () => {
  let answerMe: (response: Response) => void = () => undefined;
  const api = mockApi({
    // The session check hangs until the test answers it.
    "GET /api/auth/me": () => new Promise<Response>((resolve) => (answerMe = resolve)),
    "GET /api/items": () => json({ items: [], next_cursor: null }),
    "GET /api/items/upload-limits": () => json(LIMITS),
  });
  renderRoute("/");

  expect(await screen.findByText("Checking your session")).toBeInTheDocument();
  await waitFor(() => expect(requested(api, "/api/items")).toBe(true));

  answerMe(json(USER));
  // (jsdom applies no CSS, so the hidden page counts as visible here; the spinner is the signal.)
  await waitFor(() => expect(screen.queryByText("Checking your session")).toBeNull());
  expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
  // Mounted once: the library didn't ask for its items a second time when it became visible.
  expect(
    api.mock.calls.filter(([r]) => new URL((r as Request).url).pathname === "/api/items"),
  ).toHaveLength(1);
});

test("a signed-out visitor still ends up on the sign-in page", async () => {
  const signedOut = () => json({ detail: "Not signed in" }, 401);
  mockApi({
    "GET /api/auth/me": signedOut,
    "GET /api/items": signedOut,
    "GET /api/items/upload-limits": signedOut,
  });
  const { router } = renderRoute("/shares");

  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(router.state.location.search).toBe(`?next=${encodeURIComponent("/shares")}`);
});
