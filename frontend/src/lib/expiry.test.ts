import { expect, test } from "vitest";

import { expiryDate, toDateInput } from "./expiry";

const NOW = new Date(2026, 10, 3, 14, 30); // 3 Nov 2026, 14:30 local time

test("fixed choices count from now", () => {
  expect(expiryDate("1d", "", NOW)).toEqual(new Date(2026, 10, 4, 14, 30));
  expect(expiryDate("7d", "", NOW)).toEqual(new Date(2026, 10, 10, 14, 30));
  expect(expiryDate("30d", "", NOW)?.getTime()).toBe(NOW.getTime() + 30 * 24 * 3600 * 1000);
  expect(expiryDate("never", "", NOW)).toBeNull();
});

test("a picked date lasts until the end of that day, local time", () => {
  expect(expiryDate("custom", "2026-11-14", NOW)).toEqual(new Date(2026, 10, 14, 23, 59, 59));
  expect(expiryDate("custom", "", NOW)).toBeNull();
  expect(expiryDate("custom", "14/11/2026", NOW)).toBeNull();
});

test("dates for date inputs use the local calendar day", () => {
  expect(toDateInput(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
});
