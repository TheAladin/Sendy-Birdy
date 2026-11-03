import { Film, Image as ImageIcon, Play, StickyNote } from "lucide-react";
import { type ReactNode, useId } from "react";

import { type ItemSummary, thumbnailUrl } from "../../api/items";
import { formatBytes, formatDateTime, formatDuration, formatRelative } from "../../lib/format";

const KIND = {
  image: { label: "Image", icon: ImageIcon },
  video: { label: "Video", icon: Film },
  note: { label: "Note", icon: StickyNote },
};

/** "PNG", "MP4", "MOV" (video/quicktime), or "Note". */
function formatLabel(item: ItemSummary): string {
  if (item.kind === "note" || !item.mime_type) return "Note";
  const subtype = item.mime_type.split("/")[1] ?? "";
  return subtype === "quicktime" ? "MOV" : subtype.toUpperCase();
}

function Preview({ item }: { item: ItemSummary }) {
  if (item.kind === "note") {
    return (
      // Top padding keeps the text clear of the kind badge.
      <div className="absolute inset-0 bg-amber-50 px-4 pt-10 dark:bg-amber-500/10">
        <p className="line-clamp-3 text-xs leading-relaxed text-zinc-700 sm:line-clamp-4 dark:text-zinc-300">
          {item.excerpt}
        </p>
      </div>
    );
  }
  if (!item.has_thumbnail) {
    return (
      <div className="absolute inset-0 grid place-items-center text-zinc-400">
        <Film className="size-10" aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={thumbnailUrl(item.id)}
      alt=""
      loading="lazy"
      decoding="async"
      // Screens start at the top left (navigation, headlines), so crop from there.
      className="absolute inset-0 size-full object-cover object-left-top"
    />
  );
}

interface ItemCardProps {
  item: ItemSummary;
  /** Opens the item in the viewer; makes the whole preview a button. */
  onOpen?: () => void;
  actions?: ReactNode;
}

export function ItemCard({ item, onOpen, actions }: ItemCardProps) {
  const titleId = useId();
  const { label, icon: KindIcon } = KIND[item.kind];
  const created = new Date(item.created_at);
  const details = [formatLabel(item), item.size_bytes != null && formatBytes(item.size_bytes)]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      aria-labelledby={titleId}
      className="overflow-hidden rounded-card border border-zinc-200 bg-white shadow-card dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        <Preview item={item} />
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open ${item.title}`}
            className="absolute inset-0 cursor-zoom-in focus-visible:outline-offset-[-3px]"
          />
        )}
        <span className="pointer-events-none absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-zinc-800 shadow-sm backdrop-blur dark:bg-zinc-950/80 dark:text-zinc-200">
          <KindIcon className="size-3" aria-hidden="true" />
          {label}
        </span>
        {actions && <div className="absolute top-2 right-2 z-10 flex gap-1">{actions}</div>}
        {item.kind === "video" && (
          <>
            <span
              className="pointer-events-none absolute inset-0 grid place-items-center"
              aria-hidden="true"
            >
              <span className="grid size-11 place-items-center rounded-full bg-zinc-950/60 text-white backdrop-blur">
                <Play className="ml-0.5 size-5 fill-current" />
              </span>
            </span>
            {item.duration_s != null && (
              <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-zinc-950/75 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
                <span className="sr-only">Duration </span>
                {formatDuration(item.duration_s)}
              </span>
            )}
          </>
        )}
      </div>
      <div className="p-3">
        <h3 id={titleId} className="truncate text-sm font-medium" title={item.title}>
          {item.title}
        </h3>
        <p className="mt-1 truncate text-xs text-zinc-600 tabular-nums dark:text-zinc-400">
          {details} ·{" "}
          <time dateTime={item.created_at} title={formatDateTime(created)}>
            {formatRelative(created)}
          </time>
        </p>
      </div>
    </article>
  );
}

export function ItemCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-card border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="aspect-[4/3] bg-zinc-100 motion-safe:animate-pulse dark:bg-zinc-800" />
      <div className="grid gap-2 p-3">
        <div className="h-3.5 w-3/4 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
        <div className="h-3 w-1/2 rounded bg-zinc-100 motion-safe:animate-pulse dark:bg-zinc-800" />
      </div>
    </div>
  );
}
