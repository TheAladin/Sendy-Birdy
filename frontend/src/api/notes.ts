import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import { apiError, apiErrorFrom } from "./errors";
import type { components } from "./schema";

export type ItemOut = components["schemas"]["ItemOut"];
export const MAX_NOTE_BYTES = 100 * 1024;

export const itemQueryKey = (id: string) => ["item", id] as const;

/** One item in full (for a note, including its Markdown text). */
export function useItem(id: string | undefined) {
  return useQuery({
    queryKey: itemQueryKey(id ?? ""),
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/items/{item_id}", {
        params: { path: { item_id: id ?? "" } },
        signal,
      });
      if (!data) throw apiError(response);
      return data;
    },
  });
}

interface NoteInput {
  title: string;
  body: string;
}

export function useSaveNote(id?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (note: NoteInput): Promise<ItemOut> => {
      const { data, error, response } = id
        ? await api.PATCH("/api/items/{item_id}", {
            params: { path: { item_id: id } },
            body: note,
          })
        : await api.POST("/api/items/notes", { body: note });
      if (!data) throw apiErrorFrom(response, error);
      return data;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(itemQueryKey(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}
