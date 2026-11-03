import { Upload as UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

/**
 * While mounted, files dropped anywhere on the page, or pasted (Ctrl/Cmd+V) outside a text
 * field, are handed to onFiles. Shows a full-page hint while files are dragged over.
 */
export function DropAndPaste({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child element crossed; count them to know when we left.
  const depth = useRef(0);
  const latest = useRef(onFiles);
  useEffect(() => {
    latest.current = onFiles;
  });

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    // Without preventDefault on dragover, the browser would open the dropped file itself.
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) latest.current(files);
    };
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Pasting into the search box (or any text field) should paste text, not upload.
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return;
      event.preventDefault();
      latest.current(files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  if (!dragging) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-brand-600/10 p-6 backdrop-blur-sm"
    >
      <div className="grid w-full max-w-md place-items-center gap-3 rounded-card border-2 border-dashed border-brand-600 bg-white/90 px-8 py-12 text-center dark:bg-zinc-900/90">
        <UploadIcon className="size-10 text-brand-700 dark:text-brand-300" />
        <p className="text-lg font-semibold">Drop to upload</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Images and videos go straight into your library.
        </p>
      </div>
    </div>
  );
}
