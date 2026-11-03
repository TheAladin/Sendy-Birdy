import { createContext, useContext } from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
}

export const ToastContext = createContext<((toast: ToastOptions) => void) | null>(null);

/** Returns a function that shows a short notification: toast({ title: "Link copied" }). */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <Toaster>.");
  return show;
}
