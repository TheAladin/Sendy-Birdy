import { LogOut } from "lucide-react";
import { useNavigate } from "react-router";

import { useLogout, useMe } from "../api/auth";
import { Logo } from "../components/brand/Logo";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Display";

/** Temporary signed-in landing page; the app shell and library replace it. */
export default function HomePage() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-sm p-8">
        <Logo />
        <h1 className="mt-8 text-xl font-semibold tracking-tight">
          Signed in as {me.data?.display_name}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{me.data?.email}</p>
        <Button
          variant="secondary"
          className="mt-8"
          loading={logout.isPending}
          onClick={() =>
            logout.mutate(undefined, {
              onSettled: () => void navigate("/login", { replace: true }),
            })
          }
        >
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </Button>
      </Card>
    </main>
  );
}
