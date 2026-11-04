import { Clock, Download, Expand, Link2Off, SearchX, WifiOff } from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useState } from "react";
import { useParams } from "react-router";

import {
  type PublicItem,
  type PublicShare,
  publicDownloadUrl,
  publicFileUrl,
  publicThumbnailUrl,
  ShareUnavailable,
  usePublicShare,
} from "../../api/public";
import { Logo } from "../../components/brand/Logo";
import { ImageViewer } from "../../components/public/ImageViewer";
import { UnlockForm } from "../../components/public/UnlockForm";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Display";
import { formatBytes, formatDateTime, formatDuration, formatRelative } from "../../lib/format";
import { loadingHints, thumbnailSize } from "../../lib/media";
import { useDocumentTitle } from "../../lib/useDocumentTitle";

// Markdown is the biggest chunk of the page. Imported normally, it would have to download before
// the share could even be requested; started here, both download at once. The content waits
// for both (see <Suspense> below), so nothing jumps when it arrives.
const markdownModule = import("../../components/Markdown");
const Markdown = lazy(() => markdownModule.then((module) => ({ default: module.Markdown })));

/** Visitors are told what's logged about them, and for how long. */
function PrivacyNotice({ days }: { days: number }) {
  return (
    <p>
      Visits to this page are logged (IP address, browser, time) for security and deleted after{" "}
      {days} days.
    </p>
  );
}

function Layout({ children, retentionDays }: { children: ReactNode; retentionDays?: number }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
          <Logo />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {children}
      </main>
      <footer className="mx-auto grid w-full max-w-5xl gap-1 px-4 pb-8 text-xs text-zinc-600 sm:px-6 dark:text-zinc-400">
        {/* Only where something is actually logged: an opened or a locked link. */}
        {retentionDays !== undefined && <PrivacyNotice days={retentionDays} />}
        <p>A private link, shared with Sendy Birdy. Please don't forward it.</p>
      </footer>
    </div>
  );
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 [&>svg]:size-6">
        {icon}
      </span>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{children}</div>
    </div>
  );
}

interface UnavailableProps {
  token: string;
  error: Error;
  onRetry: () => void;
}

function Unavailable({ token, error, onRetry }: UnavailableProps) {
  if (!(error instanceof ShareUnavailable)) {
    return (
      <Notice icon={<WifiOff />} title="This page couldn't be loaded">
        <p>Check your connection and try again.</p>
        <Button className="mt-5" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </Notice>
    );
  }
  switch (error.state.reason) {
    case "not-found":
      return (
        <Notice icon={<SearchX />} title="This link doesn't exist">
          <p>Check that it was copied completely: links are long, and easy to cut short.</p>
        </Notice>
      );
    case "expired":
      return (
        <Notice icon={<Clock />} title="This link has expired">
          <p>Ask the person who sent it for a new one.</p>
        </Notice>
      );
    case "revoked":
      return (
        <Notice icon={<Link2Off />} title="This link is no longer available">
          <p>The person who shared it turned it off. Ask them if you still need the files.</p>
        </Notice>
      );
    case "locked":
      return <UnlockForm token={token} sharedBy={error.state.sharedBy} />;
  }
}

function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-2/3 max-w-md" />
      <Skeleton className="mt-3 h-4 w-48" />
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="aspect-[4/3]" />
        ))}
      </div>
    </div>
  );
}

function Meta({ item }: { item: PublicItem }) {
  const parts = [
    item.kind === "video" && item.duration_s != null && formatDuration(item.duration_s),
    item.size_bytes != null && formatBytes(item.size_bytes),
  ].filter(Boolean);
  return parts.length ? (
    <span className="text-xs text-zinc-600 tabular-nums dark:text-zinc-400">
      {parts.join(" · ")}
    </span>
  ) : null;
}

/** Most notes open with their title as a heading; showing it twice looks like a mistake. */
function startsWithTitle(item: PublicItem): boolean {
  const firstLine = (item.body ?? "").trimStart().split("\n", 1)[0] ?? "";
  return firstLine.replace(/^#+\s*/, "").trim() === item.title.trim() && firstLine.startsWith("#");
}

interface GalleryProps {
  share: PublicShare;
  token: string;
  onOpenImage: (id: string) => void;
}

function Gallery({ share, token, onOpenImage }: GalleryProps) {
  return (
    <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {share.items.map((item, index) => {
        if (item.kind === "note") {
          return (
            // Notes are read, not glanced at: they take the full width.
            <li key={item.id} className="sm:col-span-2 lg:col-span-3">
              <article className="rounded-card border border-zinc-200 bg-white p-6 shadow-card sm:p-8 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
                {!startsWithTitle(item) && (
                  <h2 className="mb-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    {item.title}
                  </h2>
                )}
                <Markdown>{item.body ?? ""}</Markdown>
              </article>
            </li>
          );
        }
        const thumb = item.has_thumbnail ? publicThumbnailUrl(token, item.id) : undefined;
        return (
          <li key={item.id}>
            <figure>
              <div className="overflow-hidden rounded-card border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                {item.kind === "image" ? (
                  <button
                    type="button"
                    onClick={() => onOpenImage(item.id)}
                    aria-label={`View ${item.title} full size`}
                    className="group relative block aspect-[4/3] w-full cursor-zoom-in focus-visible:outline-offset-[-3px]"
                  >
                    <img
                      src={thumb}
                      alt=""
                      {...thumbnailSize(item)}
                      {...loadingHints(index)}
                      decoding="async"
                      // Screenshots matter most at the top left (logo, navigation, headline).
                      className="size-full object-cover object-left-top motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-[1.02]"
                    />
                    <span className="absolute right-2 bottom-2 grid size-8 place-items-center rounded-full bg-zinc-950/60 text-white opacity-0 backdrop-blur group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Expand className="size-4" aria-hidden="true" />
                    </span>
                  </button>
                ) : (
                  // preload="none": nothing downloads until the client presses play.
                  // eslint-disable-next-line jsx-a11y-x/media-has-caption -- screen recordings come without captions
                  <video
                    src={publicFileUrl(token, item.id)}
                    poster={thumb}
                    controls
                    playsInline
                    preload="none"
                    aria-label={item.title}
                    // The same shape as images, so captions line up across a row.
                    className="aspect-[4/3] w-full bg-black object-contain"
                  />
                )}
              </div>
              <figcaption className="mt-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={item.title}>
                    {item.title}
                  </p>
                  <Meta item={item} />
                </div>
                {share.allow_downloads && (
                  <a
                    href={publicDownloadUrl(token, item.id)}
                    aria-label={`Download ${item.title}`}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-zinc-300 px-2.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Download className="size-3.5" aria-hidden="true" />
                    Download
                  </a>
                )}
              </figcaption>
            </figure>
          </li>
        );
      })}
    </ul>
  );
}

function ShareContent({ share, token }: { share: PublicShare; token: string }) {
  useDocumentTitle(share.title);
  const images = share.items.filter((item) => item.kind === "image");
  const [viewing, setViewing] = useState<number | undefined>();
  const fileUrl = useCallback((id: string) => publicFileUrl(token, id), [token]);
  const downloadUrl = useCallback((id: string) => publicDownloadUrl(token, id), [token]);
  const expires = share.expires_at ? new Date(share.expires_at) : null;

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {share.title}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {share.shared_by && <>Shared by {share.shared_by}</>}
          {share.shared_by && expires && " · "}
          {expires && (
            <time dateTime={share.expires_at ?? ""} title={formatDateTime(expires)}>
              available until {formatDateTime(expires)} ({formatRelative(expires)})
            </time>
          )}
        </p>
      </header>

      {share.message && (
        <section
          aria-label="Message"
          className="mt-8 max-w-3xl rounded-card border border-zinc-200 bg-white p-5 shadow-card sm:p-6 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none"
        >
          <Markdown>{share.message}</Markdown>
        </section>
      )}

      <section aria-label="Shared items" className="mt-10">
        {share.items.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            There's nothing in this link anymore.
          </p>
        ) : (
          <Gallery
            share={share}
            token={token}
            onOpenImage={(id) => setViewing(images.findIndex((image) => image.id === id))}
          />
        )}
      </section>

      {viewing !== undefined && (
        <ImageViewer
          images={images}
          index={viewing}
          onIndexChange={setViewing}
          onClose={() => setViewing(undefined)}
          fileUrl={fileUrl}
          downloadUrl={share.allow_downloads ? downloadUrl : undefined}
        />
      )}
    </>
  );
}

export default function SharePage() {
  const { token = "" } = useParams();
  const share = usePublicShare(token);

  const locked =
    share.error instanceof ShareUnavailable && share.error.state.reason === "locked"
      ? share.error.state.retentionDays
      : undefined;

  return (
    <Layout retentionDays={share.data?.retention_days ?? locked}>
      {share.data ? (
        <Suspense fallback={<Loading />}>
          <ShareContent share={share.data} token={token} />
        </Suspense>
      ) : share.error ? (
        <Unavailable token={token} error={share.error} onRetry={() => void share.refetch()} />
      ) : (
        <Loading />
      )}
    </Layout>
  );
}
