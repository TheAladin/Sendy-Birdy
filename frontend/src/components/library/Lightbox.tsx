import { ChevronLeft, ChevronRight, Download, Info, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { type ItemSummary, thumbnailUrl } from "../../api/items";
import { useItem } from "../../api/notes";
import { cn } from "../../lib/cn";
import { formatBytes, formatDateTime, formatDuration } from "../../lib/format";
import { imageSize } from "../../lib/media";
import { LazyMarkdown } from "../LazyMarkdown";
import { IconButton } from "../ui/Button";
import { Spinner } from "../ui/Display";

const fileUrl = (id: string) => `/api/items/${id}/file`;

function formatName(item: ItemSummary): string {
  if (item.kind === "note") return "Markdown note";
  const subtype = item.mime_type?.split("/")[1] ?? "";
  return `${subtype === "quicktime" ? "MOV" : subtype.toUpperCase()} ${item.kind}`;
}

function NoteView({ id }: { id: string }) {
  const note = useItem(id);
  if (!note.data) {
    return note.isError ? (
      <p className="text-zinc-300">This note couldn't be loaded.</p>
    ) : (
      <Spinner label="Loading note" className="text-zinc-300" />
    );
  }
  return (
    <div className="max-h-full w-full max-w-3xl overflow-y-auto rounded-card bg-white p-8 text-zinc-900 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100">
      <LazyMarkdown>{note.data.body ?? ""}</LazyMarkdown>
    </div>
  );
}

function Media({ item }: { item: ItemSummary }) {
  if (item.kind === "note") return <NoteView id={item.id} />;
  if (item.kind === "video") {
    return (
      // Uploads are screen recordings without caption files; an empty <track> would only
      // silence this rule without helping anyone, so the exception is stated instead.
      // eslint-disable-next-line jsx-a11y-x/media-has-caption
      <video
        // A new element per video, so switching items never shows the previous one's frame.
        key={item.id}
        src={fileUrl(item.id)}
        poster={item.has_thumbnail ? thumbnailUrl(item.id) : undefined}
        controls
        playsInline
        preload="metadata"
        className="max-h-full max-w-full rounded-lg bg-black shadow-2xl"
      />
    );
  }
  return (
    <img
      key={item.id}
      src={fileUrl(item.id)}
      alt={item.title}
      // The real size, so the box is right before the file arrives; CSS still scales it down.
      {...imageSize(item)}
      className="h-auto max-h-full w-auto max-w-full rounded-lg object-contain shadow-2xl"
    />
  );
}

function Details({ item }: { item: ItemSummary }) {
  const rows: [string, string][] = [
    ["Type", formatName(item)],
    ...(item.size_bytes != null
      ? [["Size", formatBytes(item.size_bytes)] as [string, string]]
      : []),
    ...(item.width && item.height
      ? [["Dimensions", `${item.width} × ${item.height}`] as [string, string]]
      : []),
    ...(item.duration_s != null
      ? [["Duration", formatDuration(item.duration_s)] as [string, string]]
      : []),
    ...(item.original_filename
      ? [["Original file", item.original_filename] as [string, string]]
      : []),
    ["Uploaded", formatDateTime(new Date(item.created_at))],
  ];
  return (
    <dl className="grid gap-4 text-sm">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-zinc-400">{label}</dt>
          <dd className="mt-0.5 break-words text-zinc-100">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface LightboxProps {
  items: ItemSummary[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Called when the last loaded item is shown, so more can be fetched. */
  onReachEnd?: () => void;
}

/**
 * Full-screen viewer for images, videos and notes. ←/→ move between items (except while
 * focus is in a video, whose controls use those keys), Esc closes, and focus goes back to
 * whatever opened it.
 */
export function Lightbox({ items, index, onIndexChange, onClose, onReachEnd }: LightboxProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // Open beside the media on wide screens; on phones it would cover the media, so it starts closed.
  const [showDetails, setShowDetails] = useState(
    () => window.matchMedia?.("(min-width: 768px)").matches ?? true,
  );
  const item = items[index];
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    // Start focus on the viewer itself (not its first button, where Enter would download),
    // so the arrow keys work immediately.
    dialog?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      // Browsers usually restore focus themselves; doing it explicitly makes it certain.
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    if (index === items.length - 1) onReachEnd?.();
    // Fetch the next image early, so moving forward feels instant.
    const next = items[index + 1];
    if (next?.kind === "image") new Image().src = fileUrl(next.id);
  }, [index, items, onReachEnd]);

  if (!item) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.target instanceof HTMLVideoElement) return;
    if (event.key === "ArrowRight" && hasNext) onIndexChange(index + 1);
    else if (event.key === "ArrowLeft" && hasPrevious) onIndexChange(index - 1);
    else return;
    event.preventDefault();
  };

  return (
    // The native dialog handles the focus trap and makes the page behind it inert.
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-label={item.title}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-zinc-950 p-0 text-zinc-100 backdrop:bg-zinc-950"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">{item.title}</h2>
            <p className="text-xs text-zinc-400 tabular-nums">
              {index + 1} of {items.length}
            </p>
          </div>
          {item.kind !== "note" && (
            <a
              href={`${fileUrl(item.id)}?download=1`}
              className="inline-flex h-9 items-center gap-2 rounded-control px-3 text-sm font-medium text-zinc-100 hover:bg-white/10"
            >
              <Download className="size-4" aria-hidden="true" />
              Download
            </a>
          )}
          <IconButton
            label={showDetails ? "Hide details" : "Show details"}
            aria-pressed={showDetails}
            icon={<Info className="size-5" />}
            className="text-zinc-100 hover:bg-white/10"
            onClick={() => setShowDetails((shown) => !shown)}
          />
          <IconButton
            label="Close"
            icon={<X className="size-5" />}
            className="text-zinc-100 hover:bg-white/10"
            onClick={onClose}
          />
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center p-4 sm:px-16">
            <Media item={item} />
            <IconButton
              label="Previous item"
              icon={<ChevronLeft className="size-6" />}
              disabled={!hasPrevious}
              className="absolute top-1/2 left-2 size-11 -translate-y-1/2 rounded-full bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800 disabled:opacity-0"
              onClick={() => onIndexChange(index - 1)}
            />
            <IconButton
              label="Next item"
              icon={<ChevronRight className="size-6" />}
              disabled={!hasNext}
              className="absolute top-1/2 right-2 size-11 -translate-y-1/2 rounded-full bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800 disabled:opacity-0"
              onClick={() => onIndexChange(index + 1)}
            />
          </div>
          <aside
            aria-label="Details"
            className={cn(
              "shrink-0 overflow-y-auto border-white/10 p-5",
              // Below the media on phones, beside it on wider screens.
              "max-h-[40%] border-t md:max-h-none md:w-72 md:border-t-0 md:border-l",
              !showDetails && "hidden",
            )}
          >
            <Details item={item} />
          </aside>
        </div>
        <p className="sr-only" aria-live="polite">
          {`${item.title}, ${index + 1} of ${items.length}`}
        </p>
      </div>
    </dialog>
  );
}
