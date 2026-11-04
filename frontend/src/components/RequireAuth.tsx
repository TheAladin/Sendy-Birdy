import { Navigate, Outlet, useLocation } from "react-router";

import { useMe } from "../api/auth";
import { Button } from "./ui/Button";
import { Spinner } from "./ui/Display";

/** Wraps every admin page: shows them only when signed in, otherwise sends you to /login. */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  const checking = me.isPending;

  if (!checking && me.isError) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="font-medium">Can't reach the server.</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Check that the backend is running, then try again.
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => void me.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!checking && me.data === null) {
    const next = location.pathname + location.search + location.hash;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return (
    <>
      {checking && (
        <div className="grid min-h-dvh place-items-center">
          <Spinner label="Checking your session" />
        </div>
      )}
      {/* While the session is checked, the page already renders, hidden, so its own requests
          (the library's items) run alongside the check instead of after it. A signed-out
          visitor sees nothing: those requests get 401s, which mark the session as signed out.
          It's the same element either way, so the page isn't mounted twice. */}
      <div className={checking ? "hidden" : "contents"}>
        <Outlet />
      </div>
    </>
  );
}
