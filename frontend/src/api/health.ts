import { useQuery } from "@tanstack/react-query";

import { api } from "./client";

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/api/health", { signal });
      if (!data) throw new Error("Health check failed");
      return data;
    },
    // A status indicator should say "unreachable" quickly rather than retry for seconds.
    retry: false,
  });
}
