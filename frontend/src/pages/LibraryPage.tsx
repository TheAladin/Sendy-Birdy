import {
  CheckSquare,
  Ellipsis,
  ImagePlus,
  NotebookPen,
  Pencil,
  SearchX,
  Share2,
  TextCursorInput,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import {
  type ItemKind,
  type ItemSummary,
  useDeleteItems,
  useItems,
  useRenameItem,
} from "../api/items";
import { ItemCard, ItemCardSkeleton } from "../components/library/ItemCard";
import { Lightbox } from "../components/library/Lightbox";
import { NoteEditor } from "../components/library/NoteEditor";
import { PageHeader } from "../components/PageHeader";
import { AffectedShares } from "../components/shares/AffectedShares";
import { ShareDialog } from "../components/shares/ShareDialog";
import { Button, IconButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState, Spinner } from "../components/ui/Display";
import { Input } from "../components/ui/Input";
import { Menu } from "../components/ui/Menu";
import { useToast } from "../components/ui/toast";
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
  // Index (in the loaded results) of the item open in the viewer.
  const [viewing, setViewing] = useState<number | undefined>();
  const [renaming, setRenaming] = useState<string | undefined>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // The last item clicked in selection mode; Shift-click selects everything from it.
  const [anchor, setAnchor] = useState<string | undefined>();
  // Items waiting for the user to confirm deletion.
  const [deleting, setDeleting] = useState<ItemSummary[] | undefined>();
  // Items being shared, in the order they'll appear (grid order to start with).
  const [sharing, setSharing] = useState<ItemSummary[] | undefined>();
  // The card to focus once deleted cards are gone, so keyboard users keep their place.
  const focusAfterDelete = useRef<string | undefined>(undefined);
  const rename = useRenameItem();
  const remove = useDeleteItems();
  const toast = useToast();
  const uploadButton = (
    <Button onClick={() => filePicker.current?.click()}>
      <Upload className="size-4" aria-hidden="true" />
      Upload
    </Button>
  );

  const results = items.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(kind ?? q.trim());
  const selectedItems = results.filter((item) => selected.has(item.id));

  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    setAnchor(undefined);
  }, []);

  const toggleSelected = (index: number, range: boolean) => {
    const item = results[index];
    if (!item) return;
    const from = range && anchor ? results.findIndex((other) => other.id === anchor) : -1;
    setSelected((previous) => {
      const next = new Set(previous);
      if (from >= 0) {
        const [start, end] = from < index ? [from, index] : [index, from];
        for (const other of results.slice(start, end + 1)) next.add(other.id);
      } else if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
    setAnchor(item.id);
  };

  const confirmDelete = () => {
    const targets = deleting ?? [];
    setDeleting(undefined);
    if (targets.length === 0) return;
    const gone = new Set(targets.map((item) => item.id));
    const first = results.findIndex((item) => gone.has(item.id));
    const neighbour =
      results.slice(first).find((item) => !gone.has(item.id)) ??
      results
        .slice(0, first)
        .reverse()
        .find((item) => !gone.has(item.id));
    focusAfterDelete.current = neighbour?.id;
    if (selecting) stopSelecting();
    remove.mutate([...gone], {
      onSuccess: () =>
        toast({
          tone: "success",
          title:
            targets.length === 1
              ? `Deleted "${targets[0]?.title}"`
              : `Deleted ${targets.length} items`,
        }),
      onError: () =>
        toast({
          tone: "error",
          title: "Couldn't delete",
          description: "The library was restored. Try again in a moment.",
        }),
    });
  };

  // Runs after every render: the deleted cards leave the grid a moment after confirming.
  useEffect(() => {
    const id = focusAfterDelete.current;
    if (!id) return;
    const card = document.querySelector<HTMLElement>(`[data-item-id="${id}"] [data-card-focus]`);
    if (card) {
      card.focus();
      focusAfterDelete.current = undefined;
    }
  });

  // Esc leaves selection mode, unless a dialog or menu is using it.
  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      stopSelecting();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selecting, stopSelecting]);

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
  const fetchMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
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
    <div className={cn("grid gap-6", selecting && "pb-20")}>
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
      {viewing !== undefined && results[viewing] && (
        <Lightbox
          items={results}
          index={viewing}
          onIndexChange={setViewing}
          onClose={() => setViewing(undefined)}
          onReachEnd={hasNextPage && !isFetchingNextPage ? fetchMore : undefined}
        />
      )}
      <Dialog
        open={deleting !== undefined}
        onClose={() => setDeleting(undefined)}
        title={
          deleting?.length === 1
            ? `Delete "${deleting[0]?.title}"?`
            : `Delete ${deleting?.length ?? 0} items?`
        }
        description={`${deleting?.length === 1 ? "It" : "They"}'ll be removed from your library and from disk. This can't be undone.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(undefined)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        {deleting && <AffectedShares items={deleting} />}
      </Dialog>
      {selecting && (
        <section
          aria-label="Selection"
          className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-lg items-center gap-2 rounded-card border border-zinc-200 bg-white p-2 pl-4 shadow-xl lg:left-64 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <p className="mr-auto text-sm font-medium tabular-nums" aria-live="polite">
            {selectedItems.length} selected
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set(results.map((item) => item.id)))}
          >
            Select all
          </Button>
          <Button
            size="sm"
            disabled={selectedItems.length === 0}
            onClick={() => setSharing(selectedItems)}
          >
            <Share2 className="size-4" aria-hidden="true" />
            Share
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={selectedItems.length === 0}
            onClick={() => setDeleting(selectedItems)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </Button>
          <Button variant="secondary" size="sm" onClick={stopSelecting}>
            Done
          </Button>
        </section>
      )}
      {sharing && (
        <ShareDialog
          items={sharing}
          onClose={() => setSharing(undefined)}
          onCreated={() => {
            if (selecting) stopSelecting();
          }}
        />
      )}
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
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            variant="secondary"
            aria-pressed={selecting}
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            className={cn(selecting && "border-brand-600 dark:border-brand-400")}
          >
            <CheckSquare className="size-4" aria-hidden="true" />
            Select
          </Button>
          <div className="min-w-0 flex-1 sm:w-72 sm:flex-none">
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
            {results.map((item, index) => (
              <li key={item.id}>
                <ItemCard
                  item={item}
                  index={index}
                  onOpen={() => setViewing(index)}
                  selection={
                    selecting
                      ? {
                          selected: selected.has(item.id),
                          onToggle: (range) => toggleSelected(index, range),
                        }
                      : undefined
                  }
                  renaming={renaming === item.id}
                  onRenameEnd={(title) => {
                    setRenaming(undefined);
                    if (!title) return;
                    rename.mutate(
                      { id: item.id, title },
                      {
                        onError: (error) =>
                          toast({
                            tone: "error",
                            title: "Couldn't rename",
                            description: error.message,
                          }),
                      },
                    );
                  }}
                  actions={
                    <>
                      {item.kind === "note" && (
                        <IconButton
                          label={`Edit ${item.title}`}
                          icon={<Pencil className="size-4" />}
                          variant="secondary"
                          className="size-8 shadow-sm"
                          onClick={() => setEditingNote(item.id)}
                        />
                      )}
                      <Menu
                        label={`Actions for ${item.title}`}
                        icon={<Ellipsis className="size-4" />}
                        variant="secondary"
                        className="size-8 shadow-sm"
                        items={[
                          {
                            label: "Share…",
                            icon: <Share2 />,
                            onSelect: () => setSharing([item]),
                          },
                          {
                            label: "Rename",
                            icon: <TextCursorInput />,
                            onSelect: () => setRenaming(item.id),
                          },
                          {
                            label: "Select",
                            icon: <CheckSquare />,
                            onSelect: () => {
                              setSelecting(true);
                              setSelected(new Set([item.id]));
                              setAnchor(item.id);
                            },
                          },
                          {
                            label: "Delete",
                            icon: <Trash2 />,
                            danger: true,
                            onSelect: () => setDeleting([item]),
                          },
                        ]}
                      />
                    </>
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
