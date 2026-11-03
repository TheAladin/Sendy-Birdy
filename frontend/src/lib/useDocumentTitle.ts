import { useEffect } from "react";

/** Sets the browser tab title, e.g. "Shares · Sendy Birdy". */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Sendy Birdy`;
  }, [title]);
}
