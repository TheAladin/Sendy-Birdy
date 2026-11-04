import { Check, Film, Image as ImageIcon, Play, StickyNote } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";

import { type ItemSummary, thumbnailUrl } from "../../api/items";
import { cn } from "../../lib/cn";
import { formatBytes, formatDateTime, formatDuration, formatRelative } from "../../lib/format";
import { loadingHints, thumbnailSize } from "../../lib/media";

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

function Preview({ item, index }: { item: ItemSummary; index: number }) {
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
      {...thumbnailSize(item)}
      {...loadingHints(index)}
      decoding="async"
      // Screens start at the top left (navigation, headlines), so crop from there.
      className="absolute inset-0 size-full object-cover object-left-top"
    />
  );
}

interface ItemCardProps {
  item: ItemSummary;
  /** Position in the grid: the first few images load right away (see loadingHints). */
  index?: number;
  /** Opens the item in the viewer; makes the whole preview a button. */
  onOpen?: () => void;
  actions?: ReactNode;
  /** In selection mode the preview becomes a checkbox instead, and actions are hidden. */
  selection?: { selected: boolean; onToggle: (range: boolean) => void };
  /** Shows an input in place of the title; called with the new title, or null to cancel. */
  renaming?: boolean;
  onRenameEnd?: (title: string | null) => void;
}

function RenameField({
  title,
  label,
  onDone,
}: {
  title: string;
  label: string;
  onDone: (title: string | null, refocus: boolean) => void;
}) {
  const [value, setValue] = useState(title);
  const finished = useRef(false);
  const finish = (save: boolean, refocus: boolean) => {
    // Enter and Esc unmount the input, which also fires blur; only the first one counts.
    if (finished.current) return;
    finished.current = true;
    const trimmed = value.trim();
    onDone(save && trimmed && trimmed !== title ? trimmed : null, refocus);
  };
  return (
    <input
      // Focus moves here as soon as the user picks "Rename", like renaming a file on a desktop.
      // eslint-disable-next-line jsx-a11y-x/no-autofocus
      autoFocus
      aria-label={label}
      value={value}
      maxLength={200}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(true, true);
        else if (event.key === "Escape") finish(false, true);
        else return;
        event.preventDefault();
      }}
      onBlur={() => finish(true, false)}
      className="-mx-1 w-[calc(100%+0.5rem)] rounded border border-brand-600 bg-white px-1 text-sm font-medium outline-none dark:bg-zinc-950"
    />
  );
}

export function ItemCard({
  item,
  index = 0,
  onOpen,
  actions,
  selection,
  renaming = false,
  onRenameEnd,
}: ItemCardProps) {
  const titleId = useId();
  const openRef = useRef<HTMLButtonElement>(null);
  const { label, icon: KindIcon } = KIND[item.kind];
  const created = new Date(item.created_at);
  const details = [formatLabel(item), item.size_bytes != null && formatBytes(item.size_bytes)]
    .filter(Boolean)
    .join(" · ");
  const selected = selection?.selected ?? false;

  return (
    <article
      aria-labelledby={titleId}
      data-item-id={item.id}
      className={cn(
        "group overflow-hidden rounded-card border bg-white shadow-card dark:bg-zinc-900 dark:shadow-none",
        selected
          ? "border-brand-600 ring-2 ring-brand-600 dark:border-brand-400 dark:ring-brand-400"
          : "border-zinc-200 dark:border-zinc-800",
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        <Preview item={item} index={index} />
        {selection ? (
          <>
            {/* The real control covers the preview, so a click anywhere toggles it. */}
            <input
              type="checkbox"
              data-card-focus
              aria-label={`Select ${item.title}`}
              checked={selected}
              onChange={(event) =>
                selection.onToggle((event.nativeEvent as MouseEvent).shiftKey === true)
              }
              className="peer absolute inset-0 z-10 cursor-pointer appearance-none focus-visible:outline-offset-[-3px]"
            />
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute top-2 right-2 grid size-6 place-items-center rounded-md border-2 shadow-sm",
                selected
                  ? "border-brand-700 bg-brand-700 text-white"
                  : "border-zinc-400 bg-white/90 dark:border-zinc-500 dark:bg-zinc-950/80",
              )}
            >
              {selected && <Check className="size-4" strokeWidth={3} />}
            </span>
            {selected && <span className="pointer-events-none absolute inset-0 bg-brand-500/10" />}
          </>
        ) : (
          onOpen && (
            <button
              ref={openRef}
              type="button"
              data-card-focus
              onClick={onOpen}
              aria-label={`Open ${item.title}`}
              className="absolute inset-0 cursor-zoom-in focus-visible:outline-offset-[-3px]"
            />
          )
        )}
        <span className="pointer-events-none absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-zinc-800 shadow-sm backdrop-blur dark:bg-zinc-950/80 dark:text-zinc-200">
          <KindIcon className="size-3" aria-hidden="true" />
          {label}
        </span>
        {actions && !selection && (
          <div
            className={cn(
              "absolute top-2 right-2 z-10 flex gap-1",
              // With a mouse, actions appear on hover or keyboard focus; touch screens always show them.
              "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100",
            )}
          >
            {actions}
          </div>
        )}
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
        {renaming ? (
          <>
            <h2 id={titleId} className="sr-only">
              {item.title}
            </h2>
            <RenameField
              title={item.title}
              label={`New title for ${item.title}`}
              onDone={(title, refocus) => {
                onRenameEnd?.(title);
                if (refocus) openRef.current?.focus();
              }}
            />
          </>
        ) : (
          <h2 id={titleId} className="truncate text-sm font-medium" title={item.title}>
            {item.title}
          </h2>
        )}
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
