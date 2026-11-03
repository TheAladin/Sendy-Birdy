import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Film,
  StickyNote,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { type ItemSummary, thumbnailUrl } from "../../api/items";
import { type ShareOut, useCreateShare } from "../../api/shares";
import { copyText } from "../../lib/clipboard";
import { cn } from "../../lib/cn";
import { EXPIRY_CHOICES, type ExpiryChoice, expiryDate, toDateInput } from "../../lib/expiry";
import { formatDateTime } from "../../lib/format";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Input, Textarea } from "../ui/Input";

const MIN_PASSWORD = 4;

function defaultTitle(items: ItemSummary[]): string {
  const [first] = items;
  if (!first) return "";
  return items.length === 1 ? first.title : `${first.title} and ${items.length - 1} more`;
}

function ItemThumb({ item }: { item: ItemSummary }) {
  if (item.kind !== "note" && item.has_thumbnail) {
    return (
      <img
        src={thumbnailUrl(item.id)}
        alt=""
        className="size-10 shrink-0 rounded object-cover object-left-top"
      />
    );
  }
  const Icon = item.kind === "note" ? StickyNote : Film;
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

interface OrderProps {
  items: ItemSummary[];
  onChange: (items: ItemSummary[]) => void;
}

/** The items in the order the client will see them, reorderable with buttons (keyboard-friendly). */
function ItemOrder({ items, onChange }: OrderProps) {
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  const move = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange(next);
    setAnnouncement(`${moved.title} moved to position ${to + 1} of ${next.length}.`);
    // Keep focus on the same button of the moved item, so it can be pressed again.
    const direction = to < from ? "up" : "down";
    requestAnimationFrame(() => {
      const row = listRef.current?.children[to];
      const button =
        row?.querySelector<HTMLButtonElement>(`[data-move="${direction}"]:not(:disabled)`) ??
        row?.querySelector<HTMLButtonElement>("[data-move]:not(:disabled)");
      button?.focus();
    });
  };

  return (
    <>
      <ol
        ref={listRef}
        className="max-h-56 divide-y divide-zinc-200 overflow-y-auto rounded-control border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800"
      >
        {items.map((item, index) => (
          <li key={item.id} className="flex items-center gap-3 px-2 py-1.5">
            <span className="w-5 text-right text-xs text-zinc-600 tabular-nums dark:text-zinc-400">
              {index + 1}
            </span>
            <ItemThumb item={item} />
            <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
            <IconButton
              label={`Move ${item.title} up`}
              icon={<ArrowUp className="size-4" />}
              data-move="up"
              disabled={index === 0}
              className="size-8"
              onClick={() => move(index, index - 1)}
            />
            <IconButton
              label={`Move ${item.title} down`}
              icon={<ArrowDown className="size-4" />}
              data-move="down"
              disabled={index === items.length - 1}
              className="size-8"
              onClick={() => move(index, index + 1)}
            />
            <IconButton
              label={`Remove ${item.title}`}
              icon={<X className="size-4" />}
              disabled={items.length === 1}
              className="size-8"
              onClick={() => {
                onChange(items.filter((other) => other.id !== item.id));
                setAnnouncement(`${item.title} removed.`);
              }}
            />
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

function ShareForm({
  initialItems,
  onCreated,
  onCancel,
}: {
  initialItems: ItemSummary[];
  onCreated: (share: ShareOut, password: string | null) => void;
  onCancel: () => void;
}) {
  const radioName = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState(initialItems);
  const [title, setTitle] = useState(() => defaultTitle(initialItems));
  const [message, setMessage] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>("7d");
  const [customDate, setCustomDate] = useState("");
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState("");
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const create = useCreateShare();

  const today = toDateInput(new Date());
  const expiresAt = expiryDate(expiry, customDate);
  const errors = {
    title: !title.trim() ? "Give the link a title." : undefined,
    date:
      expiry !== "custom"
        ? undefined
        : !customDate
          ? "Pick the last day the link works."
          : expiresAt && expiresAt <= new Date()
            ? "Pick a date in the future."
            : undefined,
    password:
      protect && password.length < MIN_PASSWORD
        ? `Use at least ${MIN_PASSWORD} characters.`
        : undefined,
  };
  const shown = (error: string | undefined) => (submitted ? error : undefined);

  // The title is ready to type over, or Enter creates the link straight away.
  useEffect(() => titleRef.current?.select(), []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    create.mutate(
      {
        title: title.trim(),
        item_ids: items.map((item) => item.id),
        message: message.trim() ? message : null,
        expires_at: expiresAt?.toISOString() ?? null,
        allow_downloads: allowDownloads,
        password: protect ? password : null,
      },
      { onSuccess: (share) => onCreated(share, protect ? password : null) },
    );
  };

  return (
    <Dialog
      open
      wide
      onClose={onCancel}
      initialFocus={titleRef}
      onSubmit={onSubmit}
      title="Share"
      description={`${items.length} item${items.length === 1 ? "" : "s"}, in the order your client will see them.`}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Create link
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        {create.error && (
          <p
            role="alert"
            className="flex gap-2 rounded-control bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {create.error.message}
          </p>
        )}
        <Field label="Title" hint="Your client sees this at the top." error={shown(errors.title)}>
          {(control) => (
            <Input
              ref={titleRef}
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              {...control}
            />
          )}
        </Field>

        <Field label="Message (optional)" hint="Markdown works: **bold**, lists, links.">
          {(control) => (
            <Textarea
              rows={3}
              value={message}
              placeholder="Hi! Here are the new screens…"
              onChange={(event) => setMessage(event.target.value)}
              {...control}
            />
          )}
        </Field>

        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Items</legend>
          <ItemOrder items={items} onChange={setItems} />
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm font-medium">Link expires after</legend>
          <div className="flex flex-wrap gap-1 rounded-control bg-zinc-100 p-1 dark:bg-zinc-800/60">
            {EXPIRY_CHOICES.map((choice) => (
              <label
                key={choice.value}
                className={cn(
                  "cursor-pointer rounded-[calc(var(--radius-control)-0.125rem)] px-3 py-1.5 text-sm font-medium",
                  "has-focus-visible:outline-2 has-focus-visible:outline-brand-600",
                  expiry === choice.value
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                )}
              >
                <input
                  type="radio"
                  name={radioName}
                  value={choice.value}
                  checked={expiry === choice.value}
                  onChange={() => setExpiry(choice.value)}
                  className="sr-only"
                />
                {choice.label}
              </label>
            ))}
          </div>
          {expiry === "custom" ? (
            <Field label="Last day" error={shown(errors.date)}>
              {(control) => (
                <Input
                  type="date"
                  min={today}
                  value={customDate}
                  onChange={(event) => setCustomDate(event.target.value)}
                  className="w-auto"
                  {...control}
                />
              )}
            </Field>
          ) : (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {expiresAt
                ? `Works until ${formatDateTime(expiresAt)}.`
                : "Works until you revoke it."}
            </p>
          )}
        </fieldset>

        <div className="grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={protect}
              onChange={(event) => setProtect(event.target.checked)}
              className="size-4 accent-brand-700"
            />
            Require a password
          </label>
          {protect && (
            <Field
              label="Password"
              hint="Send it to your client separately, not with the link."
              error={shown(errors.password)}
            >
              {(control) => (
                // Plain text on purpose: you'll need to read it to pass it on.
                <Input
                  value={password}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={128}
                  onChange={(event) => setPassword(event.target.value)}
                  {...control}
                />
              )}
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowDownloads}
              onChange={(event) => setAllowDownloads(event.target.checked)}
              className="size-4 accent-brand-700"
            />
            Allow downloads
          </label>
        </div>
      </div>
    </Dialog>
  );
}

function ShareCreated({
  share,
  password,
  copied,
  onCopy,
  onClose,
}: {
  share: ShareOut;
  password: string | null;
  /** undefined while the first copy is still running. */
  copied: boolean | undefined;
  onCopy: () => void;
  onClose: () => void;
}) {
  const copyRef = useRef<HTMLButtonElement>(null);

  const details = [
    `${share.item_count} item${share.item_count === 1 ? "" : "s"}`,
    share.expires_at ? `expires ${formatDateTime(new Date(share.expires_at))}` : "never expires",
    share.has_password && "password protected",
    !share.allow_downloads && "downloads off",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Link ready"
      description={details}
      initialFocus={copyRef}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="grid gap-3">
        <div className="flex gap-2">
          <label htmlFor="share-link" className="sr-only">
            Link
          </label>
          <Input
            id="share-link"
            readOnly
            value={share.url}
            onFocus={(event) => event.target.select()}
            className="font-mono text-xs"
          />
          <Button ref={copyRef} variant="secondary" onClick={onCopy}>
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <a
            href={share.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-control border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Open
          </a>
        </div>
        <p className="text-sm" role="status">
          {copied === true && "The link is on your clipboard, ready to paste."}
          {copied === false && "Couldn't copy automatically. Select the link and copy it."}
        </p>
        {password && (
          <p className="rounded-control bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            Password: <span className="font-mono font-medium">{password}</span>. Send it in a
            separate message.
          </p>
        )}
      </div>
    </Dialog>
  );
}

interface ShareDialogProps {
  items: ItemSummary[];
  onClose: () => void;
  /** Called once the link exists, e.g. to leave selection mode. */
  onCreated?: () => void;
}

export function ShareDialog({ items, onClose, onCreated }: ShareDialogProps) {
  const [created, setCreated] = useState<{ share: ShareOut; password: string | null }>();
  const [copied, setCopied] = useState<boolean | undefined>();
  const copy = (url: string) => void copyText(url).then(setCopied);

  if (created) {
    return (
      <ShareCreated
        {...created}
        copied={copied}
        onCopy={() => copy(created.share.url)}
        onClose={onClose}
      />
    );
  }
  return (
    <ShareForm
      initialItems={items}
      onCancel={onClose}
      onCreated={(share, password) => {
        setCreated({ share, password });
        // Copied straight away: most of the time, pasting is all that's left to do.
        copy(share.url);
        onCreated?.();
      }}
    />
  );
}
