import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/cn";

const variants = {
  // brand-700 and darker keep white text above WCAG AA contrast (brand-600 does not).
  primary: "bg-brand-700 text-white hover:bg-brand-800",
  secondary:
    "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
  ghost: "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
  danger: "bg-red-700 text-white hover:bg-red-800",
};

const sizes = {
  sm: "h-8 gap-1.5 px-3 text-sm",
  md: "h-10 gap-2 px-4 text-sm",
  icon: "size-9",
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Shows a spinner and blocks clicks while an action is running. */
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control font-medium motion-safe:transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonProps, "size" | "children" | "aria-label"> {
  /** Required: an icon alone means nothing to a screen reader. */
  label: string;
  icon: ReactNode;
}

export function IconButton({ label, icon, variant = "ghost", ...props }: IconButtonProps) {
  return (
    <Button variant={variant} size="icon" aria-label={label} title={label} {...props}>
      {icon}
    </Button>
  );
}
