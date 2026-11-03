import {
  Activity,
  Download,
  Eye,
  KeyRound,
  LogIn,
  SearchX,
  ShieldAlert,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { type AccessEvent, type EventKind, useActivity } from "../api/activity";
import { useShares } from "../api/shares";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { EmptyState, Skeleton, Spinner } from "../components/ui/Display";
import { cn } from "../lib/cn";
import { formatDateTime, formatRelative } from "../lib/format";
import { describeUserAgent } from "../lib/userAgent";

const EVENTS: Record<EventKind, { label: string; icon: ReactNode; tone: string }> = {
  share_viewed: { label: "Link opened", icon: <Eye />, tone: "text-brand-700 dark:text-brand-300" },
  file_downloaded: {
    label: "File downloaded",
    icon: <Download />,
    tone: "text-emerald-700 dark:text-emerald-400",
  },
  unlock_failed: {
    label: "Wrong link password",
    icon: <KeyRound />,
    tone: "text-amber-700 dark:text-amber-400",
  },
  login_succeeded: {
    label: "Signed in",
    icon: <LogIn />,
    tone: "text-zinc-600 dark:text-zinc-400",
  },
  login_failed: {
    label: "Sign-in failed",
    icon: <ShieldAlert />,
    tone: "text-red-700 dark:text-red-400",
  },
  share_revoked: {
    label: "Link revoked",
    icon: <ShieldOff />,
    tone: "text-zinc-600 dark:text-zinc-400",
  },
  item_deleted: {
    label: "Item deleted",
    icon: <Trash2 />,
    tone: "text-zinc-600 dark:text-zinc-400",
  },
};

const FILTERS = {
  views: { label: "Views", kinds: ["share_viewed"] },
  downloads: { label: "Downloads", kinds: ["file_downloaded"] },
  security: {
    label: "Sign-ins & passwords",
    kinds: ["login_succeeded", "login_failed", "unlock_failed"],
  },
  changes: { label: "Changes", kinds: ["share_revoked", "item_deleted"] },
} satisfies Record<string, { label: string; kinds: EventKind[] }>;
type FilterName = keyof typeof FILTERS;

function parseFilter(value: string | null): FilterName | undefined {
  return value && value in FILTERS ? (value as FilterName) : undefined;
}

/** What the event was about: "Hero.png from Northwind", "Northwind", or nothing. */
function Subject({ event }: { event: AccessEvent }) {
  const share = event.share_title && (
    <>
      {event.share_id ? (
        <Link
          to={`?share=${event.share_id}`}
          className="font-medium hover:underline"
          title="Show only this link's activity"
        >
          {event.share_title}
        </Link>
      ) : (
        // The link was deleted since; its title is all that's left.
        <span className="font-medium">{event.share_title}</span>
      )}
    </>
  );
  if (event.item_title && share) {
    return (
      <>
        {event.item_title} <span className="text-zinc-600 dark:text-zinc-400">from</span> {share}
      </>
    );
  }
  return event.item_title ? <>{event.item_title}</> : share || <span aria-hidden="true">–</span>;
}

function When({ event }: { event: AccessEvent }) {
  const date = new Date(event.created_at);
  return (
    <time dateTime={event.created_at} title={formatDateTime(date)} className="whitespace-nowrap">
      {formatRelative(date)}
    </time>
  );
}

function EventLabel({ kind }: { kind: EventKind }) {
  const { label, icon, tone } = EVENTS[kind];
  return (
    <span className="flex items-center gap-2 font-medium">
      <span aria-hidden="true" className={cn("shrink-0 [&>svg]:size-4", tone)}>
        {icon}
      </span>
      {label}
    </span>
  );
}

function EventTable({ events }: { events: AccessEvent[] }) {
  return (
    <>
      {/* Phones: one card-like row per event. */}
      <ul className="divide-y divide-zinc-200 rounded-card border border-zinc-200 bg-white md:hidden dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {events.map((event) => (
          <li key={event.id} className="grid gap-1 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <EventLabel kind={event.kind} />
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                <When event={event} />
              </span>
            </div>
            <div className="min-w-0 truncate">
              <Subject event={event} />
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              {[event.ip, describeUserAgent(event.user_agent)].filter(Boolean).join(" · ")}
            </div>
          </li>
        ))}
      </ul>
      {/* Wider screens: a real table. */}
      <div className="hidden overflow-x-auto rounded-card border border-zinc-200 bg-white shadow-card md:block dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Event
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Link or item
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                When
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                IP address
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Browser
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {events.map((event) => (
              <tr key={event.id}>
                <td className="px-4 py-2.5">
                  <EventLabel kind={event.kind} />
                </td>
                <td className="max-w-xs truncate px-4 py-2.5">
                  <Subject event={event} />
                </td>
                <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                  <When event={event} />
                </td>
                <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{event.ip ?? "–"}</td>
                <td
                  className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400"
                  title={event.user_agent ?? undefined}
                >
                  {describeUserAgent(event.user_agent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function ActivityPage() {
  const [searchParams] = useSearchParams();
  const filter = parseFilter(searchParams.get("type"));
  const shareId = searchParams.get("share") ?? undefined;
  const activity = useActivity({ shareId, kinds: filter ? FILTERS[filter].kinds : undefined });
  const shares = useShares();
  const events = activity.data?.pages.flatMap((page) => page.events) ?? [];
  const shareTitle =
    shares.data?.find((share) => share.id === shareId)?.title ??
    events.find((event) => event.share_id === shareId)?.share_title ??
    "this link";

  const href = (changes: { type?: FilterName | null; share?: string | null }) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    return query ? `?${query}` : "?";
  };

  return (
    <div className="grid gap-6">
      <PageHeader title="Activity" description="Who opened your links, and when." />

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Filter by event">
          <ul className="flex flex-wrap gap-1 rounded-control bg-zinc-100 p-1 dark:bg-zinc-800/60">
            {[undefined, ...(Object.keys(FILTERS) as FilterName[])].map((name) => {
              const active = name === filter;
              return (
                <li key={name ?? "all"}>
                  <Link
                    to={href({ type: name ?? null })}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-[calc(var(--radius-control)-0.125rem)] px-3 py-1.5 text-sm font-medium",
                      active
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                    )}
                  >
                    {name ? FILTERS[name].label : "All"}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {shareId && (
          <p className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pr-1 pl-3 text-sm text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
            Only “{shareTitle}”
            <Link
              to={href({ share: null })}
              aria-label="Show activity for all links"
              title="Show activity for all links"
              className="grid size-6 place-items-center rounded-full hover:bg-brand-100 dark:hover:bg-brand-500/20"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Link>
          </p>
        )}
      </div>

      {activity.isPending ? (
        <div className="grid gap-2" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-11" />
          ))}
        </div>
      ) : activity.isError ? (
        <div className="rounded-card border border-zinc-200 p-8 text-center dark:border-zinc-800">
          <p className="font-medium">The activity log couldn't be loaded.</p>
          <Button className="mt-4" variant="secondary" onClick={() => void activity.refetch()}>
            Try again
          </Button>
        </div>
      ) : events.length === 0 ? (
        filter || shareId ? (
          <EmptyState
            icon={<SearchX />}
            title="Nothing here yet"
            description="No events match these filters."
            action={
              <Link
                to="?"
                className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                Show all activity
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Activity />}
            title="No activity yet"
            description="When clients open your links or download files, it shows up here."
          />
        )
      ) : (
        <>
          <EventTable events={events} />
          <div className="flex justify-center">
            {activity.isFetchingNextPage ? (
              <Spinner label="Loading more activity" />
            ) : (
              activity.hasNextPage && (
                <Button variant="secondary" onClick={() => void activity.fetchNextPage()}>
                  Load more
                </Button>
              )
            )}
          </div>
        </>
      )}
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Events are deleted automatically after the retention period (90 days unless you changed{" "}
        <code>LOG_RETENTION_DAYS</code>).
      </p>
    </div>
  );
}
