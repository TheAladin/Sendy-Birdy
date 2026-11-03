import { ImagePlus, NotebookPen, Pencil, SearchX, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { type ItemKind, useItems } from "../api/items";
import { ItemCard, ItemCardSkeleton } from "../components/library/ItemCard";
import { NoteEditor } from "../components/library/NoteEditor";
import { PageHeader } from "../components/PageHeader";
import { Button, IconButton } from "../components/ui/Button";
import { EmptyState, Spinner } from "../components/ui/Display";
import { Input } from "../components/ui/Input";
import { DropAndPaste } from "../features/uploads/DropAndPaste";
import { nameForUpload, useUploadLimits, useUploadQueue } from "../features/uploads/context";
import { cn } from "../lib/cn";

const FILTERS: { kind?: ItemKind; label: string }[] = [
  { label: "All" },
  { kind: "image", label: "Images" },
  { kind: "video", label: "Videos" },
  { kind: "note", label: "Notes" },
];
const SEARCH_DELAY_MS = 300;

function parseKind(value: string | null): ItemKind | undefined {
  return value === "image" || value === "video" || value === "note" ? value : undefined;
}

export default function LibraryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = parseKind(searchParams.get("kind"));
  const q = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const items = useItems({ kind, q: q.trim() });
  const sentinel = useRef<HTMLDivElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const queue = useUploadQueue();
  const limits = useUploadLimits();
  const addFiles = useCallback(
    (files: File[]) => queue.add(files, (file) => nameForUpload(file)),
    [queue],
  );
  // undefined: closed; "new": creating; otherwise the id of the note being edited.
  const [editingNote, setEditingNote] = useState<string | undefined>();
  const uploadButton = (
    <Button onClick={() => filePicker.current?.click()}>
      <Upload className="size-4" aria-hidden="true" />
      Upload
    </Button>
  );

  const results = items.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(kind ?? q.trim());

  // Typing updates the box immediately, but the URL (and so the request) only after a pause.
  const onSearchChange = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchParams(
        (params) => {
          if (value.trim()) params.set("q", value);
          else params.delete("q");
          return params;
        },
        { replace: true },
      );
    }, SEARCH_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  // Load the next page automatically when the end of the grid scrolls into view.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = items;
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const filterHref = (filterKind?: ItemKind) => {
    const params = new URLSearchParams();
    if (filterKind) params.set("kind", filterKind);
    if (q) params.set("q", q);
    const query = params.toString();
    return query ? `?${query}` : "?";
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Library"
        description="Your screenshots, videos and notes."
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditingNote("new")}>
              <NotebookPen className="size-4" aria-hidden="true" />
              New note
            </Button>
            {uploadButton}
          </>
        }
      />
      {editingNote && (
        <NoteEditor
          noteId={editingNote === "new" ? undefined : editingNote}
          onClose={() => setEditingNote(undefined)}
        />
      )}
      <input
        ref={filePicker}
        type="file"
        multiple
        hidden
        accept={limits.data?.acceptedTypes.join(",") ?? "image/*,video/*"}
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          // Reset, so choosing the same file again still triggers a change.
          event.target.value = "";
        }}
      />
      <DropAndPaste onFiles={addFiles} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by type">
          <ul className="flex gap-1 rounded-control bg-zinc-100 p-1 dark:bg-zinc-800/60">
            {FILTERS.map((filter) => {
              const active = filter.kind === kind;
              return (
                <li key={filter.label}>
                  <Link
                    to={filterHref(filter.kind)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-[calc(var(--radius-control)-0.125rem)] px-3 py-1.5 text-sm font-medium",
                      active
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                    )}
                  >
                    {filter.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="w-full sm:w-72">
          <label htmlFor="library-search" className="sr-only">
            Search titles
          </label>
          <Input
            id="library-search"
            type="search"
            placeholder="Search titles…"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {items.isSuccess &&
          `${results.length}${hasNextPage ? " or more" : ""} item${results.length === 1 ? "" : "s"}`}
      </p>

      {items.isPending ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index}>
              <ItemCardSkeleton />
            </li>
          ))}
        </ul>
      ) : items.isError ? (
        <div className="rounded-card border border-zinc-200 p-8 text-center dark:border-zinc-800">
          <p className="font-medium">The library couldn't be loaded.</p>
          <Button className="mt-4" variant="secondary" onClick={() => void items.refetch()}>
            Try again
          </Button>
        </div>
      ) : results.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchX />}
            title="Nothing matches"
            description={
              q.trim()
                ? `No items with "${q.trim()}" in their title.`
                : "No items of this type yet."
            }
            action={
              <Link
                to="?"
                onClick={() => setSearch("")}
                className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                Show everything
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<ImagePlus />}
            title="Your library is empty"
            description="Upload screenshots or demo videos, drop them anywhere on this page, or paste a screenshot with Ctrl+V."
            action={uploadButton}
          />
        )
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {results.map((item) => (
              <li key={item.id}>
                <ItemCard
                  item={item}
                  actions={
                    item.kind === "note" && (
                      <IconButton
                        label={`Edit ${item.title}`}
                        icon={<Pencil className="size-4" />}
                        variant="secondary"
                        className="size-8 shadow-sm"
                        onClick={() => setEditingNote(item.id)}
                      />
                    )
                  }
                />
              </li>
            ))}
          </ul>
          <div ref={sentinel} className="flex justify-center">
            {isFetchingNextPage ? (
              <Spinner label="Loading more items" />
            ) : (
              hasNextPage && (
                <Button variant="secondary" onClick={() => void fetchNextPage()}>
                  Load more
                </Button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
