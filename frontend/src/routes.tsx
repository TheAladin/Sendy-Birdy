import type { RouteObject } from "react-router";

import { RequireAuth } from "./components/RequireAuth";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";

// The UI catalogue only exists in development; production builds leave it out entirely.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [{ path: "/ui", lazy: async () => ({ Component: (await import("./pages/UiPage")).default }) }]
  : [];

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  // Everything inside requires a signed-in user.
  { element: <RequireAuth />, children: [{ path: "/", element: <HomePage /> }] },
  ...devRoutes,
  { path: "*", element: <NotFoundPage /> },
];
