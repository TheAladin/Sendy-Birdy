import { CircleCheck, CircleX, RotateCcw, X } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button, IconButton } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { formatBytes } from "../../lib/format";
import { useUploadQueue } from "./context";
import type { Upload } from "./queue";

function statusText(upload: Upload): string {
  switch (upload.status) {
    case "queued":
      return "Waiting…";
    case "uploading":
      return `${Math.round(upload.progress * 100)}% of ${formatBytes(upload.size)}`;
    case "done":
      return "Uploaded";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return upload.error ?? "Failed";
  }
}

function Row({ upload }: { upload: Upload }) {
  const queue = useUploadQueue();
  const active = upload.status === "queued" || upload.status === "uploading";
  const canRetry =
    upload.retryable && (upload.status === "failed" || upload.status === "cancelled");

  return (
    <li className="grid gap-1.5 px-4 py-3">
      <div className="flex items-center gap-2">
        {upload.status === "done" && (
          <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
        )}
        {upload.status === "failed" && (
          <CircleX className="size-4 shrink-0 text-red-600" aria-hidden="true" />
        )}
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={upload.name}>
          {upload.name}
        </p>
        {active && (
          <IconButton
            label={`Cancel ${upload.name}`}
            icon={<X className="size-4" />}
            className="size-7"
            onClick={() => queue.cancel(upload.id)}
          />
        )}
        {canRetry && (
          <IconButton
            label={`Retry ${upload.name}`}
            icon={<RotateCcw className="size-4" />}
            className="size-7"
            onClick={() => queue.retry(upload.id)}
          />
        )}
      </div>
      {upload.status === "uploading" && (
        <div
          role="progressbar"
          aria-label={`Uploading ${upload.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(upload.progress * 100)}
          className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
        >
          <div
            className="h-full rounded-full bg-brand-600 motion-safe:transition-[width]"
            style={{ width: `${upload.progress * 100}%` }}
          />
        </div>
      )}
      <p
        className={cn(
          "text-xs",
          upload.status === "failed"
            ? "text-red-700 dark:text-red-400"
            : "text-zinc-600 tabular-nums dark:text-zinc-400",
        )}
      >
        {statusText(upload)}
      </p>
    </li>
  );
}

/** Lists uploads in progress and recently finished, bottom right. */
export function UploadPanel() {
  const queue = useUploadQueue();
  const uploads = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  if (uploads.length === 0) return null;

  const active = uploads.filter((u) => u.status === "queued" || u.status === "uploading").length;
  const failed = uploads.filter((u) => u.status === "failed").length;
  const summary = active
    ? `Uploading ${active} file${active === 1 ? "" : "s"}…`
    : failed
      ? `${failed} upload${failed === 1 ? "" : "s"} failed`
      : "Uploads finished";

  return (
    <section
      aria-label="Uploads"
      className="fixed inset-x-4 bottom-4 z-40 overflow-hidden rounded-card border border-zinc-200 bg-white shadow-xl sm:left-auto sm:w-96 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <header className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
        <p className="text-sm font-semibold" aria-live="polite">
          {summary}
        </p>
        {!active && (
          <Button size="sm" variant="ghost" onClick={() => queue.clearFinished()}>
            Clear
          </Button>
        )}
      </header>
      <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
        {/* Newest first: what you just added (or what just failed) is what you look for. */}
        {uploads.toReversed().map((upload) => (
          <Row key={upload.id} upload={upload} />
        ))}
      </ul>
    </section>
  );
}
