import type { RouteObject } from "react-router";

import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import ActivityPage from "./pages/ActivityPage";
import LibraryPage from "./pages/LibraryPage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";
import SharesPage from "./pages/SharesPage";

// The UI catalogue only exists in development; production builds leave it out entirely.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [{ path: "/ui", lazy: async () => ({ Component: (await import("./pages/UiPage")).default }) }]
  : [];

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  // Everything inside requires a signed-in user and is shown inside the app shell.
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <LibraryPage /> },
          { path: "/shares", element: <SharesPage /> },
          { path: "/activity", element: <ActivityPage /> },
        ],
      },
    ],
  },
  ...devRoutes,
  { path: "*", element: <NotFoundPage /> },
];
