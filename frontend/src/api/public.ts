import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import { ApiError, apiError } from "./errors";
import type { components } from "./schema";

export type PublicShare = components["schemas"]["PublicShare"];
export type PublicItem = components["schemas"]["PublicItem"];

/** Why a share can't be shown, as the page needs to explain it. */
export type Unavailable =
  | { reason: "not-found" }
  | { reason: "expired" | "revoked" }
  | { reason: "locked"; sharedBy: string; retentionDays: number };

export class ShareUnavailable extends Error {
  readonly state: Unavailable;

  constructor(state: Unavailable) {
    super(state.reason);
    this.name = "ShareUnavailable";
    this.state = state;
  }
}

function unavailable(status: number, body: unknown): ShareUnavailable | null {
  const detail = (body as { detail?: unknown } | undefined)?.detail as
    { reason?: string; shared_by?: string; retention_days?: number } | undefined;
  if (status === 404) return new ShareUnavailable({ reason: "not-found" });
  if (status === 410 && (detail?.reason === "expired" || detail?.reason === "revoked")) {
    return new ShareUnavailable({ reason: detail.reason });
  }
  if (status === 403 && detail?.reason === "locked") {
    return new ShareUnavailable({
      reason: "locked",
      sharedBy: detail.shared_by ?? "",
      retentionDays: detail.retention_days ?? 90,
    });
  }
  return null;
}

const base = (token: string) => `/api/public/shares/${encodeURIComponent(token)}`;

export const publicFileUrl = (token: string, id: string) => `${base(token)}/items/${id}/file`;
export const publicDownloadUrl = (token: string, id: string) =>
  `${publicFileUrl(token, id)}?download=1`;
export const publicThumbnailUrl = (token: string, id: string) =>
  `${base(token)}/items/${id}/thumbnail`;

export function usePublicShare(token: string) {
  return useQuery({
    queryKey: ["public-share", token],
    // No abort signal on purpose: the server counts a view as soon as the request arrives, so
    // a cancelled request (e.g. React's dev-mode double mount) followed by a new one would be
    // counted twice. Without it, a remount simply reuses the request already in flight.
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/public/shares/{token}", {
        params: { path: { token } },
      });
      if (data) return data;
      throw unavailable(response.status, error) ?? new Error(`HTTP ${response.status}`);
    },
    // Each load counts as a view, so never reload behind the client's back.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // Retrying only helps with network trouble, not with a link that's gone.
    retry: (count, error) => !(error instanceof ShareUnavailable) && count < 2,
  });
}

/**
 * Sends a share's password. On success the server sets a cookie for this link only, and the
 * share is loaded again, now with its content. Errors are ApiErrors: 401 for a wrong password,
 * 429 (with retryAfterSeconds) after too many attempts.
 */
export function useUnlockShare(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (password: string) => {
      const { response } = await api.POST("/api/public/shares/{token}/unlock", {
        params: { path: { token } },
        body: { password },
      });
      if (!response.ok) throw apiError(response);
    },
    // Also after a 404/410 (deleted or revoked meanwhile): reloading shows why.
    onSettled: (_data, error) => {
      if (!error || (error instanceof ApiError && [404, 410].includes(error.status))) {
        return queryClient.invalidateQueries({ queryKey: ["public-share", token] });
      }
    },
  });
}
