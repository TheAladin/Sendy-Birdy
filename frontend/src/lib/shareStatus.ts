import type { ShareSummary } from "../api/shares";
import { formatRelative } from "./format";

/** Active links this close to expiring are flagged, so they can be extended in time. */
export const EXPIRING_SOON_MS = 48 * 3600 * 1000;

export type ShareState = "active" | "expiring" | "expired" | "revoked";

export function shareState(share: ShareSummary, now = new Date()): ShareState {
  if (share.status !== "active") return share.status;
  if (share.expires_at && new Date(share.expires_at).getTime() - now.getTime() < EXPIRING_SOON_MS) {
    return "expiring";
  }
  return "active";
}

/** "Expires in 6 days", "Expired 2 days ago", "Revoked yesterday", "No expiry". */
export function timeLeft(share: ShareSummary, now = new Date()): string {
  if (share.revoked_at) return `Revoked ${formatRelative(new Date(share.revoked_at), now)}`;
  if (!share.expires_at) return "No expiry";
  const when = formatRelative(new Date(share.expires_at), now);
  return share.status === "expired" ? `Expired ${when}` : `Expires ${when}`;
}
