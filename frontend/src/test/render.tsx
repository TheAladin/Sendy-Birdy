import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { createQueryClient } from "../api/queryClient";
import { Toaster } from "../components/ui/Toaster";
import { routes } from "../routes";

/** Renders the app's real routes at `path` with the real query client setup. */
export function renderRoute(path: string) {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster>
        <RouterProvider router={router} />
      </Toaster>
    </QueryClientProvider>,
  );
  return { router, queryClient };
}
