import { QueryCache, QueryClient } from "@tanstack/react-query";

import { meQueryKey } from "./auth";
import { ApiError, isClientError } from "./errors";

export function createQueryClient() {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      // A 401 from any request means the session ended (expired, or signed out elsewhere).
      // Marking the user as signed out makes the route guard send them to the login page.
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) {
          queryClient.setQueryData(meQueryKey, null);
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => !isClientError(error) && failureCount < 1,
      },
    },
  });
  return queryClient;
}
