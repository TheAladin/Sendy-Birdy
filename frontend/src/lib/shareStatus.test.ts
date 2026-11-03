import { expect, test } from "vitest";

import type { ShareSummary } from "../api/shares";
import { shareState, timeLeft } from "./shareStatus";

const NOW = new Date("2026-11-03T12:00:00Z");
const HOUR = 3600 * 1000;

function share(overrides: Partial<ShareSummary>): ShareSummary {
  return {
    id: "s",
    title: "T",
    url: "u",
    status: "active",
    expires_at: null,
    revoked_at: null,
    allow_downloads: true,
    has_password: false,
    view_count: 0,
    last_viewed_at: null,
    item_count: 1,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}
const inHours = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();

test("active links are 'expiring soon' in their last 48 hours", () => {
  expect(shareState(share({ expires_at: inHours(49) }), NOW)).toBe("active");
  expect(shareState(share({ expires_at: inHours(47) }), NOW)).toBe("expiring");
  expect(shareState(share({}), NOW)).toBe("active");
});

test("expired and revoked come from the server's status", () => {
  expect(shareState(share({ status: "expired", expires_at: inHours(-1) }), NOW)).toBe("expired");
  expect(shareState(share({ status: "revoked", revoked_at: inHours(-1) }), NOW)).toBe("revoked");
});

test("time left reads naturally", () => {
  expect(timeLeft(share({ expires_at: inHours(6 * 24) }), NOW)).toBe("Expires in 6 days");
  expect(timeLeft(share({}), NOW)).toBe("No expiry");
  expect(timeLeft(share({ status: "expired", expires_at: inHours(-48) }), NOW)).toBe(
    "Expired 2 days ago",
  );
  expect(timeLeft(share({ status: "revoked", revoked_at: inHours(-3) }), NOW)).toBe(
    "Revoked 3 hours ago",
  );
});
