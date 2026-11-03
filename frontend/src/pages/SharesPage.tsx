import {
  Activity,
  CalendarClock,
  Copy,
  Ellipsis,
  ExternalLink,
  Link2,
  Lock,
  Pencil,
  SearchX,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { type ShareSummary, useDeleteShare, useRevokeShare, useShares } from "../api/shares";
import { PageHeader } from "../components/PageHeader";
import { EditShareDialog } from "../components/shares/EditShareDialog";
import { ExtendDialog } from "../components/shares/ExtendDialog";
import { Button, IconButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Badge, EmptyState, Skeleton } from "../components/ui/Display";
import { Menu } from "../components/ui/Menu";
import { useToast } from "../components/ui/toast";
import { copyText } from "../lib/clipboard";
import { cn } from "../lib/cn";
import { formatDateTime, formatRelative } from "../lib/format";
import { type ShareState, shareState, timeLeft } from "../lib/shareStatus";

const BADGES: Record<
  ShareState,
  { label: string; tone: "success" | "warning" | "neutral" | "danger" }
> = {
  active: { label: "Active", tone: "success" },
  expiring: { label: "Expiring soon", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
  revoked: { label: "Revoked", tone: "danger" },
};

type Filter = "active" | "expired" | "revoked";
const FILTERS: { value?: Filter; label: string }[] = [
  { label: "All" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
];

function parseFilter(value: string | null): Filter | undefined {
  return value === "active" || value === "expired" || value === "revoked" ? value : undefined;
}

type Pending = { action: "edit" | "extend" | "revoke" | "delete"; share: ShareSummary } | undefined;

function ShareRow({ share, onAction }: { share: ShareSummary; onAction: (p: Pending) => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const state = shareState(share);
  const badge = BADGES[state];
  const revoked = state === "revoked";
  const views =
    share.view_count === 0
      ? "Not viewed yet"
      : `${share.view_count} view${share.view_count === 1 ? "" : "s"}`;
  const lastViewed = share.last_viewed_at ? new Date(share.last_viewed_at) : null;
  const ends = share.revoked_at ?? share.expires_at;

  const copy = async () => {
    const copied = await copyText(share.url);
    toast(
      copied
        ? { tone: "success", title: "Link copied" }
        : { tone: "error", title: "Couldn't copy", description: share.url },
    );
  };

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap">
          {/* Wraps on phones, where the actions leave little room; one line on wider screens. */}
          <h2
            className={cn(
              "min-w-0 font-medium break-words sm:truncate",
              revoked && "text-zinc-600 dark:text-zinc-400",
            )}
          >
            {share.title}
          </h2>
          {share.has_password && (
            <span title="Password protected" className="shrink-0 text-zinc-600 dark:text-zinc-400">
              <Lock className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Password protected</span>
            </span>
          )}
          <Badge tone={badge.tone} className="shrink-0">
            {badge.label}
          </Badge>
        </div>
        <p className="mt-1 flex flex-wrap gap-x-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <span>
            {share.item_count} item{share.item_count === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {views}
            {lastViewed && (
              <>
                , last{" "}
                <time dateTime={share.last_viewed_at ?? ""} title={formatDateTime(lastViewed)}>
                  {formatRelative(lastViewed)}
                </time>
              </>
            )}
          </span>
          <span aria-hidden="true">·</span>
          <span
            title={ends ? formatDateTime(new Date(ends)) : undefined}
            className={cn(state === "expiring" && "font-medium text-amber-800 dark:text-amber-300")}
          >
            {timeLeft(share)}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!revoked && (
          <>
            <IconButton
              label={`Copy link for ${share.title}`}
              icon={<Copy className="size-4" />}
              onClick={() => void copy()}
            />
            <a
              href={share.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${share.title}`}
              title={`Open ${share.title}`}
              className="grid size-9 place-items-center rounded-control text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </>
        )}
        <Menu
          label={`Actions for ${share.title}`}
          icon={<Ellipsis className="size-4" />}
          items={[
            {
              label: "View activity",
              icon: <Activity />,
              onSelect: () => void navigate(`/activity?share=${share.id}`),
            },
            // A revoked link can only be deleted: it never works again.
            ...(revoked
              ? []
              : [
                  {
                    label: "Edit",
                    icon: <Pencil />,
                    onSelect: () => onAction({ action: "edit", share }),
                  },
                  {
                    label: share.status === "expired" ? "Reactivate…" : "Change expiry…",
                    icon: <CalendarClock />,
                    onSelect: () => onAction({ action: "extend", share }),
                  },
                  {
                    label: "Revoke",
                    icon: <ShieldOff />,
                    danger: true,
                    onSelect: () => onAction({ action: "revoke", share }),
                  },
                ]),
            {
              label: "Delete",
              icon: <Trash2 />,
              danger: true,
              onSelect: () => onAction({ action: "delete", share }),
            },
          ]}
        />
      </div>
    </li>
  );
}

export default function SharesPage() {
  const [searchParams] = useSearchParams();
  const filter = parseFilter(searchParams.get("status"));
  const shares = useShares();
  const [pending, setPending] = useState<Pending>();
  const revoke = useRevokeShare();
  const remove = useDeleteShare();
  const toast = useToast();

  const all = shares.data ?? [];
  const shown = filter ? all.filter((share) => share.status === filter) : all;
  const count = (value?: Filter) =>
    value ? all.filter((share) => share.status === value).length : all.length;
  const close = () => setPending(undefined);

  const confirm = () => {
    if (pending?.action !== "revoke" && pending?.action !== "delete") return;
    const { action, share } = pending;
    close();
    const mutation = action === "revoke" ? revoke : remove;
    mutation.mutate(share.id, {
      onSuccess: () =>
        toast({
          tone: "success",
          title: action === "revoke" ? `Revoked "${share.title}"` : `Deleted "${share.title}"`,
        }),
      onError: (error) =>
        toast({
          tone: "error",
          title: action === "revoke" ? "Couldn't revoke" : "Couldn't delete",
          description: error.message,
        }),
    });
  };

  return (
    <div className="grid gap-6">
      <PageHeader title="Shares" description="Links you've sent to clients." />

      {all.length > 0 && (
        <nav aria-label="Filter by status">
          <ul className="flex w-fit gap-1 rounded-control bg-zinc-100 p-1 dark:bg-zinc-800/60">
            {FILTERS.map((option) => {
              const active = option.value === filter;
              return (
                <li key={option.label}>
                  <Link
                    to={option.value ? `?status=${option.value}` : "?"}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[calc(var(--radius-control)-0.125rem)] px-3 py-1.5 text-sm font-medium",
                      active
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                    )}
                  >
                    {option.label}{" "}
                    <span className="text-xs text-zinc-600 tabular-nums dark:text-zinc-400">
                      {count(option.value)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {shares.isPending ? (
        <div className="grid gap-3" aria-hidden="true">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      ) : shares.isError ? (
        <div className="rounded-card border border-zinc-200 p-8 text-center dark:border-zinc-800">
          <p className="font-medium">Your links couldn't be loaded.</p>
          <Button className="mt-4" variant="secondary" onClick={() => void shares.refetch()}>
            Try again
          </Button>
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<Link2 />}
          title="No share links yet"
          description="In the library, select some items and click Share. Your links show up here."
          action={
            <Link
              to="/"
              className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
            >
              Go to the library
            </Link>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={`No ${filter} links`}
          action={
            <Link
              to="?"
              className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
            >
              Show all links
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-card border border-zinc-200 bg-white shadow-card dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
          {shown.map((share) => (
            <ShareRow key={share.id} share={share} onAction={setPending} />
          ))}
        </ul>
      )}

      {pending?.action === "edit" && <EditShareDialog id={pending.share.id} onClose={close} />}
      {pending?.action === "extend" && <ExtendDialog share={pending.share} onClose={close} />}
      <Dialog
        open={pending?.action === "revoke" || pending?.action === "delete"}
        onClose={close}
        title={
          pending?.action === "revoke"
            ? `Revoke "${pending.share.title}"?`
            : `Delete "${pending?.share.title ?? ""}"?`
        }
        description={
          pending?.action === "revoke"
            ? "Anyone with the link loses access right away, and it can't be turned back on. You can share the items again with a new link."
            : pending?.share.status === "revoked"
              ? "It disappears from this list. The items stay in your library."
              : "The link stops working and disappears from this list. The items stay in your library."
        }
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm}>
              {pending?.action === "revoke" ? "Revoke link" : "Delete link"}
            </Button>
          </>
        }
      />
    </div>
  );
}
