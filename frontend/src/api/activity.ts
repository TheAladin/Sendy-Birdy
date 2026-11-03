import { useInfiniteQuery } from "@tanstack/react-query";

import { api } from "./client";
import { apiError } from "./errors";
import type { components } from "./schema";

export type AccessEvent = components["schemas"]["AccessEventOut"];
export type EventKind = AccessEvent["kind"];

export interface ActivityFilters {
  shareId?: string;
  kinds?: EventKind[];
}

/** The access log, newest first, page by page. */
export function useActivity(filters: ActivityFilters) {
  return useInfiniteQuery({
    queryKey: ["activity", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const { data, response } = await api.GET("/api/activity", {
        params: {
          query: { share_id: filters.shareId, kind: filters.kinds, cursor: pageParam },
        },
        signal,
      });
      if (!data) throw apiError(response);
      return data;
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
