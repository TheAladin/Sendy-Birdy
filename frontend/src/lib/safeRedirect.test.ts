import { expect, test } from "vitest";

import { safeRedirect } from "./safeRedirect";

test.each([
  ["/", "/"],
  ["/shares?status=active#top", "/shares?status=active#top"],
  ["/a/../shares", "/shares"],
])("keeps the local path %s", (next, expected) => {
  expect(safeRedirect(next)).toBe(expected);
});

test.each([
  [null],
  [""],
  ["shares"],
  ["https://evil.example/"],
  ["//evil.example/"],
  ["/\\evil.example/"],
  ["javascript:alert(1)"],
  ["/login?next=/"],
])("falls back to / for %s", (next) => {
  expect(safeRedirect(next)).toBe("/");
});
