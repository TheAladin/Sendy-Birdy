import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { api } from "./client";
import { apiError, apiErrorFrom } from "./errors";
import type { components } from "./schema";

export type ItemSummary = components["schemas"]["ItemSummary"];
type ItemPage = components["schemas"]["ItemPage"];
export type ItemKind = ItemSummary["kind"];

export interface ItemFilters {
  kind?: ItemKind;
  q?: string;
}

export const itemsQueryKey = (filters: ItemFilters) => ["items", filters] as const;

export const thumbnailUrl = (id: string) => `/api/items/${id}/thumbnail`;

/** The library, page by page; call fetchNextPage() to load more. */
export function useItems(filters: ItemFilters) {
  return useInfiniteQuery({
    queryKey: itemsQueryKey(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const { data, response } = await api.GET("/api/items", {
        params: { query: { kind: filters.kind, q: filters.q || undefined, cursor: pageParam } },
        signal,
      });
      if (!data) throw apiError(response);
      return data;
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}

type ItemPages = InfiniteData<ItemPage, string | undefined>;

/**
 * Changes every loaded library list at once (all filters and searches) and returns a function
 * that puts them back, for undoing an optimistic update when the server says no.
 */
async function updateLoadedItems(
  queryClient: QueryClient,
  update: (items: ItemSummary[]) => ItemSummary[],
): Promise<() => void> {
  // A list still loading would overwrite the change when it arrives.
  await queryClient.cancelQueries({ queryKey: ["items"] });
  const snapshot = queryClient.getQueriesData<ItemPages>({ queryKey: ["items"] });
  queryClient.setQueriesData<ItemPages>({ queryKey: ["items"] }, (data) =>
    data?.pages
      ? { ...data, pages: data.pages.map((page) => ({ ...page, items: update(page.items) })) }
      : data,
  );
  return () => {
    for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
  };
}

export function useRenameItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const { data, error, response } = await api.PATCH("/api/items/{item_id}", {
        params: { path: { item_id: id } },
        body: { title },
      });
      if (!data) throw apiErrorFrom(response, error);
      return data;
    },
    onMutate: ({ id, title }) =>
      updateLoadedItems(queryClient, (items) =>
        items.map((item) => (item.id === id ? { ...item, title } : item)),
      ),
    onError: (_error, _variables, undo) => undo?.(),
    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["item", id] });
    },
  });
}

/** The server takes at most this many ids per bulk delete. */
const BULK_DELETE_LIMIT = 500;

/** Deletes items; they leave the grid at once and come back if the server refuses. */
export function useDeleteItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 1) {
        const { response } = await api.DELETE("/api/items/{item_id}", {
          params: { path: { item_id: ids[0] ?? "" } },
        });
        // Already gone (e.g. deleted in another tab) is what we wanted anyway.
        if (!response.ok && response.status !== 404) throw apiError(response);
        return;
      }
      for (let start = 0; start < ids.length; start += BULK_DELETE_LIMIT) {
        const { data, response } = await api.POST("/api/items/bulk-delete", {
          body: { ids: ids.slice(start, start + BULK_DELETE_LIMIT) },
        });
        if (!data) throw apiError(response);
      }
    },
    onMutate: (ids) => {
      const gone = new Set(ids);
      return updateLoadedItems(queryClient, (items) => items.filter((item) => !gone.has(item.id)));
    },
    onError: (_error, _ids, undo) => undo?.(),
    onSuccess: (_data, ids) => {
      for (const id of ids) queryClient.removeQueries({ queryKey: ["item", id] });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
}
