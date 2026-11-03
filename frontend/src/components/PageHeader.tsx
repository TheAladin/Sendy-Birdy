import type { ReactNode } from "react";

import { useDocumentTitle } from "../lib/useDocumentTitle";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Buttons shown on the right, e.g. "Upload". */
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  useDocumentTitle(title);

  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
