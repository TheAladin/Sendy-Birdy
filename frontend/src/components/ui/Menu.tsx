import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { IconButton } from "./Button";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

interface MenuProps {
  /** Accessible name of the trigger button, e.g. "Actions for hero.png". */
  label: string;
  icon: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
}

/**
 * A dropdown menu following the WAI-ARIA menu button pattern: ↑/↓/Home/End move between items,
 * Enter or Space selects, Esc closes and returns focus to the button.
 */
export function Menu({ label, icon, items, align = "end" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusItem = (index: number) => {
    const count = items.length;
    itemRefs.current[(index + count) % count]?.focus();
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    const moves: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      focusItem(moves[event.key]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <IconButton
        ref={triggerRef}
        label={label}
        icon={icon}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute z-20 mt-1 min-w-44 rounded-control border border-zinc-200 bg-white p-1 shadow-card dark:border-zinc-700 dark:bg-zinc-900",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-[calc(var(--radius-control)-0.25rem)] px-2.5 py-1.5 text-left text-sm",
                "outline-none focus:bg-zinc-100 dark:focus:bg-zinc-800",
                item.danger ? "text-red-700 dark:text-red-400" : "text-zinc-800 dark:text-zinc-200",
              )}
            >
              <span aria-hidden="true" className="[&>svg]:size-4">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
