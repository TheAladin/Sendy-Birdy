import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";

import { createQueryClient } from "./api/queryClient";
import { Toaster } from "./components/ui/Toaster";
import { routes } from "./routes";

const router = createBrowserRouter(routes);

export default function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <Toaster>
        <RouterProvider router={router} />
      </Toaster>
    </QueryClientProvider>
  );
}
