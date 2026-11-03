import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { json, mockApi } from "../test/api";
import { renderRoute } from "../test/render";

const USER = {
  id: "4f1c9d6e-0000-4000-8000-000000000001",
  email: "me@example.com",
  display_name: "Alex",
};
const signedOut = () => json({ detail: "Not signed in" }, 401);

afterEach(() => {
  vi.restoreAllMocks();
});

async function signIn(password = "a long enough password") {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), USER.email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

test("signed-out visitors are sent to the login page, remembering where they were going", async () => {
  mockApi({ "GET /api/auth/me": signedOut });

  const { router } = renderRoute("/?tab=recent");

  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/login");
  expect(router.state.location.search).toBe(`?next=${encodeURIComponent("/?tab=recent")}`);
});

test("signing in sends the credentials and returns you to where you were going", async () => {
  const api = mockApi({
    "GET /api/auth/me": signedOut,
    "POST /api/auth/login": () => json(USER),
    "GET /api/items": () => json({ items: [], next_cursor: null }),
  });
  const { router } = renderRoute("/login?next=%2F%3Ftab%3Drecent");

  await signIn();

  expect(await screen.findByRole("heading", { name: "Library" })).toBeInTheDocument();
  expect(router.state.location.pathname + router.state.location.search).toBe("/?tab=recent");
  const login = api.mock.calls
    .map(([request]) => request as Request)
    .find((r) => r.method === "POST");
  expect(await login?.json()).toEqual({ email: USER.email, password: "a long enough password" });
  expect(login?.headers.get("X-Requested-With")).toBe("fetch");
});

test("a wrong password shows an error and clears the password field", async () => {
  mockApi({
    "GET /api/auth/me": signedOut,
    "POST /api/auth/login": () => json({ detail: "Wrong email or password" }, 401),
  });
  renderRoute("/login");

  await signIn("not the password");

  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(screen.getByLabelText("Email")).toHaveValue(USER.email);
});

test("too many attempts says how long to wait", async () => {
  mockApi({
    "GET /api/auth/me": signedOut,
    "POST /api/auth/login": () =>
      json({ detail: "Too many attempts" }, 429, { "Retry-After": "120" }),
  });
  renderRoute("/login");

  await signIn();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Too many attempts. Try again in 2 minutes.",
  );
});

test("an unsafe next link is ignored after signing in", async () => {
  mockApi({
    "GET /api/auth/me": signedOut,
    "POST /api/auth/login": () => json(USER),
    "GET /api/items": () => json({ items: [], next_cursor: null }),
  });
  const { router } = renderRoute("/login?next=%2F%2Fevil.example%2F");

  await signIn();

  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});

test("visiting the login page while signed in goes straight to the app", async () => {
  mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items": () => json({ items: [], next_cursor: null }),
  });

  const { router } = renderRoute("/login");

  expect(await screen.findByRole("heading", { name: "Library" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/");
});

test("signing out ends the session and returns to the login page", async () => {
  const api = mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items": () => json({ items: [], next_cursor: null }),
    "POST /api/auth/logout": () => new Response(null, { status: 204 }),
  });
  const { router, queryClient } = renderRoute("/");

  await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/login");
  expect(api.mock.calls.some(([r]) => (r as Request).method === "POST")).toBe(true);
  expect(queryClient.getQueryData(["me"])).toBeNull();
});

test("a 401 from any request signs you out of the app", async () => {
  mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items": () => json({ items: [], next_cursor: null }),
  });
  const { queryClient } = renderRoute("/");
  expect(await screen.findByRole("heading", { name: "Library" })).toBeInTheDocument();

  // Simulates any later request finding the session expired.
  const { ApiError } = await import("../api/errors");
  await queryClient
    .fetchQuery({
      queryKey: ["something"],
      queryFn: () => Promise.reject(new ApiError(401, "expired")),
    })
    .catch(() => undefined);

  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
});
