import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import { ApiError, apiError } from "./errors";
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

/**
 * The server's own message: FastAPI's "detail" string, or the first validation message of a 422
 * (e.g. "A note can be at most 100 KB."). `body` is the error body openapi-fetch already parsed;
 * the response itself can't be read twice.
 */
function errorFrom(response: Response, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  const message = Array.isArray(detail)
    ? (detail[0] as { msg?: string } | undefined)?.msg?.replace(/^Value error, /, "")
    : detail;
  return typeof message === "string" ? new ApiError(response.status, message) : apiError(response);
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
      if (!data) throw errorFrom(response, error);
      return data;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(itemQueryKey(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}
