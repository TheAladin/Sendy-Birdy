import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { IconButton } from "./Button";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name, e.g. "Navigation". */
  label: string;
  children: ReactNode;
}

/** A panel that slides over the page from the left. Same native <dialog> behavior as Dialog. */
export function Sheet({ open, onClose, label, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const sheet = ref.current;
    if (!sheet) return;
    if (open && !sheet.open) sheet.showModal();
    if (!open && sheet.open) sheet.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={() => {
        if (open) onClose();
      }}
      className="m-0 h-dvh max-h-dvh w-72 max-w-[85vw] bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-zinc-950/50 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <div className="absolute top-3 right-3">
        <IconButton label="Close" icon={<X className="size-4" />} onClick={onClose} />
      </div>
      {open && children}
    </dialog>
  );
}
