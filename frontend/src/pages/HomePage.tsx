import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";

import { useHealth } from "../api/health";
import { Logo } from "../components/brand/Logo";

type ApiStatus = "checking…" | "ok" | "unreachable";

const statusIcon = {
  "checking…": <LoaderCircle className="size-4 animate-spin text-zinc-400" aria-hidden="true" />,
  ok: <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />,
  unreachable: <CircleX className="size-4 text-red-600 dark:text-red-400" aria-hidden="true" />,
} satisfies Record<ApiStatus, React.ReactNode>;

export default function HomePage() {
  const health = useHealth();
  const apiStatus: ApiStatus = health.isPending
    ? "checking…"
    : health.isSuccess
      ? "ok"
      : "unreachable";

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm rounded-card border border-zinc-200 bg-white p-8 shadow-card dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
        <Logo />
        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-balance">
          Send your work, not a cloud bill.
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Screenshots, demos and notes, shared through private links from your own machine.
        </p>
        <div className="mt-8 flex items-center gap-2 rounded-control bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800/60">
          {statusIcon[apiStatus]}
          <p className="font-medium">API: {apiStatus}</p>
        </div>
      </div>
    </main>
  );
}
