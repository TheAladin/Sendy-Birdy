import { CircleAlert } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useId, useState } from "react";

import { MAX_NOTE_BYTES, useItem, useSaveNote } from "../../api/notes";
import { cn } from "../../lib/cn";
import { formatBytes } from "../../lib/format";
import { Markdown } from "../Markdown";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Spinner } from "../ui/Display";
import { Field } from "../ui/Field";
import { Input, Textarea } from "../ui/Input";
import { useToast } from "../ui/toast";

const encoder = new TextEncoder();
type Tab = "write" | "preview";

interface NoteFormProps {
  noteId?: string;
  initial: { title: string; body: string };
  onClose: () => void;
}

function NoteForm({ noteId, initial, onClose }: NoteFormProps) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [tab, setTab] = useState<Tab>("write");
  const [submitted, setSubmitted] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const save = useSaveNote(noteId);
  const toast = useToast();
  const tabsId = useId();

  const bytes = encoder.encode(body).length;
  const titleError = submitted && !title.trim() ? "Give the note a title." : undefined;
  const bodyError = !submitted
    ? undefined
    : !body.trim()
      ? "Write something first."
      : bytes > MAX_NOTE_BYTES
        ? "A note can be at most 100 KB."
        : undefined;
  const dirty = title !== initial.title || body !== initial.body;

  // Every way of closing (Esc, the close button, Cancel) comes through here.
  const requestClose = () => {
    if (dirty && !confirmingDiscard) setConfirmingDiscard(true);
    else onClose();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!title.trim() || !body.trim() || bytes > MAX_NOTE_BYTES) return;
    save.mutate(
      { title: title.trim(), body },
      {
        onSuccess: () => {
          toast({ title: noteId ? "Note saved" : "Note created", tone: "success" });
          onClose();
        },
      },
    );
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: Tab = tab === "write" ? "preview" : "write";
    setTab(next);
    document.getElementById(`${tabsId}-${next}-tab`)?.focus();
  };

  return (
    <Dialog
      open
      wide
      onClose={requestClose}
      title={noteId ? "Edit note" : "New note"}
      footer={
        confirmingDiscard ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmingDiscard(false)}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={onClose}>
              Discard changes
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" form={`${tabsId}-form`} loading={save.isPending}>
              {noteId ? "Save" : "Create note"}
            </Button>
          </>
        )
      }
    >
      <form id={`${tabsId}-form`} className="grid gap-4" onSubmit={onSubmit} noValidate>
        {confirmingDiscard && (
          <p
            role="alert"
            className="rounded-control bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          >
            You have unsaved changes. Discard them?
          </p>
        )}
        {save.error && (
          <p
            role="alert"
            className="flex gap-2 rounded-control bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {save.error.message}
          </p>
        )}
        <Field label="Title" error={titleError}>
          {(control) => (
            <Input
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              {...control}
            />
          )}
        </Field>

        <div>
          <div className="flex items-end justify-between gap-2">
            <div
              role="tablist"
              tabIndex={-1}
              aria-label="Note text"
              className="flex gap-1"
              onKeyDown={onTabKeyDown}
            >
              {(["write", "preview"] as const).map((name) => (
                <button
                  key={name}
                  id={`${tabsId}-${name}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={tab === name}
                  aria-controls={`${tabsId}-${name}-panel`}
                  tabIndex={tab === name ? 0 : -1}
                  onClick={() => setTab(name)}
                  className={cn(
                    "rounded-t-control border-b-2 px-3 py-1.5 text-sm font-medium",
                    tab === name
                      ? "border-brand-600 text-zinc-900 dark:text-zinc-100"
                      : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                  )}
                >
                  {name === "write" ? "Write" : "Preview"}
                </button>
              ))}
            </div>
            <p
              className={cn(
                "text-xs tabular-nums",
                bytes > MAX_NOTE_BYTES
                  ? "font-medium text-red-700 dark:text-red-400"
                  : "text-zinc-600 dark:text-zinc-400",
              )}
            >
              {formatBytes(bytes)} of {formatBytes(MAX_NOTE_BYTES)}
            </p>
          </div>

          <div
            id={`${tabsId}-write-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-write-tab`}
            hidden={tab !== "write"}
            className="mt-2"
          >
            <Field
              label="Markdown"
              hint="Supports **bold**, lists, links, tables and more."
              error={bodyError}
            >
              {(control) => (
                <Textarea
                  rows={14}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={"# Round 2\n\n- New checkout flow\n- Faster pages"}
                  className="font-mono text-[13px] leading-relaxed"
                  {...control}
                />
              )}
            </Field>
          </div>
          <div
            id={`${tabsId}-preview-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-preview-tab`}
            hidden={tab !== "preview"}
            className="mt-2 max-h-[22rem] min-h-40 overflow-y-auto rounded-control border border-zinc-200 p-4 dark:border-zinc-700"
          >
            {body.trim() ? (
              <Markdown>{body}</Markdown>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing to preview yet.</p>
            )}
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/** Create a note, or edit one (its full text is loaded first). Render it only while open. */
export function NoteEditor({ noteId, onClose }: { noteId?: string; onClose: () => void }) {
  const note = useItem(noteId);

  if (noteId && !note.data) {
    return (
      <Dialog open wide onClose={onClose} title="Edit note">
        <div className="grid min-h-40 place-items-center">
          {note.isError ? (
            <p className="text-sm">This note couldn't be loaded.</p>
          ) : (
            <Spinner label="Loading note" />
          )}
        </div>
      </Dialog>
    );
  }
  return (
    <NoteForm
      // A fresh form per note, so its fields start from that note's saved text.
      key={noteId ?? "new"}
      noteId={noteId}
      initial={{ title: note.data?.title ?? "", body: note.data?.body ?? "" }}
      onClose={onClose}
    />
  );
}
