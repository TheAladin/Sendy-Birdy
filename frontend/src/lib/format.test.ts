import { expect, test } from "vitest";

import { formatBytes, formatDuration, formatRelative } from "./format";

test.each([
  [0, "0 B"],
  [900, "900 B"],
  [1536, "1.5 KB"],
  [10 * 1024, "10 KB"],
  [2.25 * 1024 * 1024, "2.3 MB"],
  [3 * 1024 ** 3, "3.0 GB"],
])("formatBytes(%d) = %s", (bytes, expected) => {
  expect(formatBytes(bytes)).toBe(expected);
});

test.each([
  [4.2, "0:04"],
  [75.4, "1:15"],
  [3725, "1:02:05"],
])("formatDuration(%d) = %s", (seconds, expected) => {
  expect(formatDuration(seconds)).toBe(expected);
});

test.each([
  [-20, "just now"],
  [-5 * 60, "5 minutes ago"],
  [-3 * 3600, "3 hours ago"],
  [-26 * 3600, "yesterday"],
  [-10 * 24 * 3600, "last week"],
  [-400 * 24 * 3600, "last year"],
])("formatRelative(%d seconds) = %s", (offset, expected) => {
  const now = new Date("2026-11-02T12:00:00Z");
  expect(formatRelative(new Date(now.getTime() + offset * 1000), now)).toBe(expected);
});
