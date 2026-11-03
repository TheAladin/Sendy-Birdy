import { expect, test } from "vitest";

import { cn } from "./cn";

test.each([
  [["bg-brand-700 px-4", "bg-red-600"], "px-4 bg-red-600"],
  [["rounded-control", "rounded-card"], "rounded-card"],
  [["shadow-card", "shadow-none"], "shadow-none"],
  [["p-4", false, undefined, "font-medium"], "p-4 font-medium"],
])("cn(%j) merges to %s", (inputs, expected) => {
  expect(cn(...inputs)).toBe(expected);
});
