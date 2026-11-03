import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import { apiError, apiErrorFrom } from "./errors";
import type { components } from "./schema";

export type ShareOut = components["schemas"]["ShareOut"];
export type ShareSummary = components["schemas"]["ShareSummary"];
export type ShareCreate = components["schemas"]["ShareCreate"];
export type ShareUpdate = components["schemas"]["ShareUpdate"];

export const shareQueryKey = (id: string) => ["shares", "detail", id] as const;

/** After any change: link lists, the link itself, and items' share counts are stale. */
function refresh(queryClient: QueryClient, saved?: ShareOut) {
  if (saved) queryClient.setQueryData(shareQueryKey(saved.id), saved);
  void queryClient.invalidateQueries({ queryKey: ["shares"] });
  void queryClient.invalidateQueries({ queryKey: ["items"] });
}

/** Every link, newest first; with itemIds, only links containing any of those items. */
export function useShares(itemIds?: string[], { enabled = true } = {}) {
  return useQuery({
    queryKey: ["shares", "list", itemIds ?? null],
    enabled,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/shares", {
        params: { query: { item_id: itemIds } },
        signal,
      });
      if (!data) throw apiError(response);
      return data;
    },
  });
}

/** One link in full (message and items), for editing. */
export function useShare(id: string) {
  return useQuery({
    queryKey: shareQueryKey(id),
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/shares/{share_id}", {
        params: { path: { share_id: id } },
        signal,
      });
      if (!data) throw apiError(response);
      return data;
    },
  });
}

export function useCreateShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (share: ShareCreate): Promise<ShareOut> => {
      const { data, error, response } = await api.POST("/api/shares", { body: share });
      if (!data) throw apiErrorFrom(response, error);
      return data;
    },
    onSuccess: (saved) => refresh(queryClient, saved),
  });
}

export function useUpdateShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: ShareUpdate }) => {
      const { data, error, response } = await api.PATCH("/api/shares/{share_id}", {
        params: { path: { share_id: id } },
        body: changes,
      });
      if (!data) throw apiErrorFrom(response, error);
      return data;
    },
    onSuccess: (saved) => refresh(queryClient, saved),
  });
}

export function useRevokeShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error, response } = await api.POST("/api/shares/{share_id}/revoke", {
        params: { path: { share_id: id } },
      });
      if (!data) throw apiErrorFrom(response, error);
      return data;
    },
    onSuccess: (saved) => refresh(queryClient, saved),
  });
}

export function useDeleteShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await api.DELETE("/api/shares/{share_id}", {
        params: { path: { share_id: id } },
      });
      // Already gone is what we wanted.
      if (!response.ok && response.status !== 404) throw apiErrorFrom(response, error);
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: shareQueryKey(id) });
      refresh(queryClient);
    },
  });
}
