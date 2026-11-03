import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { Markdown } from "./Markdown";

test("renders headings, emphasis, lists and GitHub tables", () => {
  render(
    <Markdown>
      {
        "# Release\n\nNow **faster** and ~~slower~~.\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |"
      }
    </Markdown>,
  );

  expect(screen.getByRole("heading", { level: 1, name: "Release" })).toBeInTheDocument();
  expect(screen.getByText("faster").tagName).toBe("STRONG");
  expect(screen.getByText("slower").tagName).toBe("DEL");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByRole("table")).toBeInTheDocument();
});

test("raw HTML is never rendered, so notes can't run scripts", () => {
  const { container } = render(
    <Markdown>
      {'Hello <img src=x onerror="alert(1)"> <script>alert(2)</script> <b>world</b>'}
    </Markdown>,
  );

  expect(container.querySelector("img, script, b")).toBeNull();
  expect(container).not.toHaveTextContent("<");
  expect(container).toHaveTextContent("Hello");
});

test("javascript: links are neutralized and real links open safely in a new tab", () => {
  const { container } = render(
    <Markdown>{"[evil](javascript:alert(1)) and [site](https://example.com)"}</Markdown>,
  );

  // The dangerous link keeps its text but stops being a link.
  expect(screen.getByText("evil").closest("a")).toBeNull();
  expect(container.innerHTML).not.toContain("javascript:");
  const site = screen.getByRole("link", { name: "site" });
  expect(site).toHaveAttribute("href", "https://example.com");
  expect(site).toHaveAttribute("target", "_blank");
  expect(site).toHaveAttribute("rel", "noopener noreferrer");
});

test("images become links, so opening a note never loads anything from another site", () => {
  const { container } = render(
    <Markdown>
      {"![Mockup](https://example.com/mockup.png) ![](https://example.com/b.png)"}
    </Markdown>,
  );

  expect(container.querySelector("img")).toBeNull();
  const mockup = screen.getByRole("link", { name: "Mockup" });
  expect(mockup).toHaveAttribute("href", "https://example.com/mockup.png");
  expect(mockup).toHaveAttribute("rel", "noopener noreferrer");
  // Without alt text, the address itself is the label.
  expect(screen.getByRole("link", { name: "https://example.com/b.png" })).toBeInTheDocument();
});

test("unsafe image addresses leave only the alt text", () => {
  const { container } = render(<Markdown>{"![Logo](javascript:alert(1))"}</Markdown>);

  expect(container.querySelector("img, a")).toBeNull();
  expect(container).toHaveTextContent("Logo");
});
