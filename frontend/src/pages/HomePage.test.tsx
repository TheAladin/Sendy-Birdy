import { screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { renderRoute } from "../test/render";

afterEach(() => {
  vi.restoreAllMocks();
});

test("shows the API status once the health check succeeds", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "ok" }));

  renderRoute("/");

  expect(screen.getByText("API: checking…")).toBeInTheDocument();
  expect(await screen.findByText("API: ok")).toBeInTheDocument();
  const request = fetchSpy.mock.calls[0]?.[0] as Request;
  expect(new URL(request.url).pathname).toBe("/api/health");
  expect(request.headers.get("X-Requested-With")).toBe("fetch");
});

test("reports the API as unreachable when the request fails", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

  renderRoute("/");

  expect(await screen.findByText("API: unreachable")).toBeInTheDocument();
});

test("reports the API as unreachable when it answers with an error", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}, { status: 500 }));

  renderRoute("/");

  expect(await screen.findByText("API: unreachable")).toBeInTheDocument();
});
