import { lazy, Suspense } from "react";

import { Skeleton } from "./ui/Display";

// react-markdown and GFM are the biggest piece of the app. The library only needs them once a
// note is opened or edited, so it downloads them then, not with the page.
const Markdown = lazy(() => import("./Markdown").then((module) => ({ default: module.Markdown })));

function MarkdownLoading() {
  return (
    <div className="grid gap-2" role="status" aria-label="Loading note">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

/** <Markdown>, loaded on first use. Pages that always show Markdown import it directly. */
export function LazyMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <Suspense fallback={<MarkdownLoading />}>
      <Markdown className={className}>{children}</Markdown>
    </Suspense>
  );
}
