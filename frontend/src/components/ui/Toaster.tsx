import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { IconButton } from "./Button";
import { ToastContext, type ToastOptions } from "./toast";

const DISMISS_AFTER_MS = 5000;

const icons = {
  success: <CircleCheck className="size-5 text-emerald-600 dark:text-emerald-400" />,
  error: <CircleX className="size-5 text-red-600 dark:text-red-400" />,
  info: <Info className="size-5 text-brand-600 dark:text-brand-400" />,
};

interface ShownToast extends Required<Pick<ToastOptions, "title" | "tone">> {
  id: number;
  description?: string;
}

/** Provides useToast() to everything inside it and renders the notifications. */
export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ShownToast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    ({ title, description, tone = "info" }: ToastOptions) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, title, description, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_AFTER_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return (
    <ToastContext value={show}>
      {children}
      {/* Always rendered, so screen readers are already watching it when a toast appears. */}
      <section
        aria-label="Notifications"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border bg-white p-4 shadow-card",
              "border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-none",
            )}
          >
            <span aria-hidden="true">{icons[toast.tone]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                  {toast.description}
                </p>
              )}
            </div>
            <IconButton
              label="Dismiss notification"
              icon={<X className="size-4" />}
              onClick={() => dismiss(toast.id)}
              className="-my-1 -mr-1 size-7"
            />
          </div>
        ))}
      </section>
    </ToastContext>
  );
}
