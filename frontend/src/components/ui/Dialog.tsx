import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

import { cn } from "../../lib/cn";
import { IconButton } from "./Button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Buttons, right-aligned at the bottom. */
  footer?: ReactNode;
  /** Room for a form or editor instead of a short message. */
  wide?: boolean;
}

/**
 * A modal built on the native <dialog> element: the browser traps focus inside it, closes it on
 * Esc, makes the rest of the page inert and returns focus to the opener afterwards.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Esc asks the parent instead of closing straight away, so it can refuse (e.g. to warn
      // about unsaved changes). The parent closes the dialog by setting open to false.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-card",
        wide ? "max-w-2xl" : "max-w-md",
        "bg-white p-6 text-zinc-900 shadow-xl backdrop:bg-zinc-950/50 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-1 dark:ring-zinc-800",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <IconButton
          label="Close"
          icon={<X className="size-4" />}
          onClick={onClose}
          className="-mt-1 -mr-2"
        />
      </div>
      {description && (
        <p id={descriptionId} className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {description}
        </p>
      )}
      {children && <div className="mt-4">{children}</div>}
      {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
    </dialog>
  );
}
