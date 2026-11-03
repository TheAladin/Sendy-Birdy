import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import { apiError } from "./errors";
import { meQueryKey } from "./keys";
import type { components } from "./schema";

export type User = components["schemas"]["UserOut"];
export type Credentials = components["schemas"]["LoginRequest"];

export { meQueryKey };

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async ({ signal }): Promise<User | null> => {
      const { data, response } = await api.GET("/api/auth/me", { signal });
      if (response.status === 401) return null;
      if (!data) throw apiError(response);
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: Credentials) => {
      const { data, response } = await api.POST("/api/auth/login", { body: credentials });
      if (!data) throw apiError(response);
      return data;
    },
    onSuccess: (user) => queryClient.setQueryData(meQueryKey, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.POST("/api/auth/logout");
    },
    // Even if the request fails, forget everything locally: nothing cached should outlive a sign-out.
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(meQueryKey, null);
    },
  });
}
