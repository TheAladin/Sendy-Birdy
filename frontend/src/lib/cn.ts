import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge our custom tokens from index.css, so that e.g. `rounded-card` passed in
// by a caller replaces a component's default `rounded-control` instead of both being applied.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["control", "card"],
      shadow: ["card"],
    },
  },
});

/** Join class names (conditionally) and let later Tailwind classes override earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
