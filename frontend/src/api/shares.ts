import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import { apiErrorFrom } from "./errors";
import type { components } from "./schema";

export type ShareOut = components["schemas"]["ShareOut"];
export type ShareCreate = components["schemas"]["ShareCreate"];

export function useCreateShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (share: ShareCreate): Promise<ShareOut> => {
      const { data, error, response } = await api.POST("/api/shares", { body: share });
      if (!data) throw apiErrorFrom(response, error);
      return data;
    },
    onSuccess: () => {
      // Items show how many links include them; the Shares page lists links.
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["shares"] });
    },
  });
}
