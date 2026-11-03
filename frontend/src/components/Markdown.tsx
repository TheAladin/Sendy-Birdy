import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../lib/cn";

const components: Components = {
  // Links in notes lead to other sites: open them in a new tab, and don't tell those sites
  // where the visitor came from (share links contain secret tokens).
  // Unsafe URLs (like javascript:) arrive here with an empty href: show just the text.
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Pictures in a note would load from another site the moment a client opens the link (the
  // page's CSP blocks that anyway), so they become links the reader can choose to follow.
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {alt || src}
      </a>
    ) : (
      <span>{alt}</span>
    ),
};

/**
 * Renders a note's Markdown, including GitHub additions (tables, task lists, strikethrough).
 * Raw HTML is dropped, and react-markdown neutralizes javascript: links, so a note can never
 * run code. The editor's preview uses this same component, so it shows exactly what clients see.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "prose max-w-none prose-zinc dark:prose-invert",
        "prose-a:text-brand-700 dark:prose-a:text-brand-300",
        "prose-headings:tracking-tight prose-pre:bg-zinc-900",
        // Note-sized headings: the default 2.25em h1 overwhelms a short note.
        "prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg",
        // GitHub task lists: the checkbox replaces the bullet.
        "[&_.contains-task-list]:list-none [&_.contains-task-list]:pl-0",
        "[&_.task-list-item_input]:mr-2 [&_.task-list-item_input]:align-middle",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
