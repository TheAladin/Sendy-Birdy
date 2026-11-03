import { useInfiniteQuery } from "@tanstack/react-query";

import { api } from "./client";
import { apiError } from "./errors";
import type { components } from "./schema";

export type ItemSummary = components["schemas"]["ItemSummary"];
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
