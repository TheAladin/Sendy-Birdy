import type { RouteObject } from "react-router";

// Every page loads on demand, so the entry bundle holds only the router and providers. That
// keeps the admin app out of what clients download for a share link, and the reverse.
const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await load()).default,
});

// The UI catalogue only exists in development; production builds leave it out entirely.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [{ path: "/ui", lazy: page(() => import("./pages/UiPage")) }]
  : [];

export const routes: RouteObject[] = [
  // What clients see: its own minimal layout, no sign-in.
  { path: "/s/:token", lazy: page(() => import("./pages/public/SharePage")) },
  { path: "/login", lazy: page(() => import("./pages/LoginPage")) },
  // Everything inside requires a signed-in user and is shown inside the app shell.
  {
    lazy: async () => ({ Component: (await import("./components/RequireAuth")).RequireAuth }),
    children: [
      {
        lazy: async () => ({ Component: (await import("./components/AppShell")).AppShell }),
        children: [
          { path: "/", lazy: page(() => import("./pages/LibraryPage")) },
          { path: "/shares", lazy: page(() => import("./pages/SharesPage")) },
          { path: "/activity", lazy: page(() => import("./pages/ActivityPage")) },
        ],
      },
    ],
  },
  ...devRoutes,
  { path: "*", lazy: page(() => import("./pages/NotFoundPage")) },
];
