import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import App from "./App";

afterEach(() => {
  vi.restoreAllMocks();
});

test("shows the API status once the health check succeeds", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "ok" }));

  render(<App />);

  expect(screen.getByText("API: checking…")).toBeInTheDocument();
  expect(await screen.findByText("API: ok")).toBeInTheDocument();
  expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/health");
});

test("reports the API as unreachable when the request fails", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

  render(<App />);

  expect(await screen.findByText("API: unreachable")).toBeInTheDocument();
});
