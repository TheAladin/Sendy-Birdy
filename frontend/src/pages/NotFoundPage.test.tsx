import { screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { renderRoute } from "../test/render";

test("unknown addresses show a not-found page with a way back", async () => {
  renderRoute("/no/such/page");

  expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to the start" })).toHaveAttribute("href", "/");
});
