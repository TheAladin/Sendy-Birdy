import type { RouteObject } from "react-router";

import HomePage from "./pages/HomePage";
import NotFoundPage from "./pages/NotFoundPage";

// The UI catalogue only exists in development; production builds leave it out entirely.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [{ path: "/ui", lazy: async () => ({ Component: (await import("./pages/UiPage")).default }) }]
  : [];

export const routes: RouteObject[] = [
  { path: "/", element: <HomePage /> },
  ...devRoutes,
  { path: "*", element: <NotFoundPage /> },
];
