import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";

import type { PublicItem } from "../../api/public";
import { imageSize } from "../../lib/media";
import { IconButton } from "../ui/Button";

interface ImageViewerProps {
  images: PublicItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  fileUrl: (id: string) => string;
  /** Present when downloads are allowed. */
  downloadUrl?: (id: string) => string;
}

/** Full-screen images for clients: ←/→ to move, Esc to close, focus back where it was. */
export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
  fileUrl,
  downloadUrl,
}: ImageViewerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const image = images[index];
  const hasPrevious = index > 0;
  const hasNext = index < images.length - 1;

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    const next = images[index + 1];
    if (next) new Image().src = fileUrl(next.id);
  }, [images, index, fileUrl]);

  if (!image) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "ArrowRight" && hasNext) onIndexChange(index + 1);
    else if (event.key === "ArrowLeft" && hasPrevious) onIndexChange(index - 1);
    else return;
    event.preventDefault();
  };

  return (
    // The native dialog traps focus and makes the page behind it inert.
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-label={image.title}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-zinc-950 p-0 text-zinc-100 backdrop:bg-zinc-950"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-medium">{image.title}</h2>
            {images.length > 1 && (
              <p className="text-xs text-zinc-400 tabular-nums">
                {index + 1} of {images.length}
              </p>
            )}
          </div>
          {downloadUrl && (
            <a
              href={downloadUrl(image.id)}
              className="inline-flex h-9 items-center gap-2 rounded-control px-3 text-sm font-medium hover:bg-white/10"
            >
              <Download className="size-4" aria-hidden="true" />
              Download
            </a>
          )}
          <IconButton
            label="Close"
            icon={<X className="size-5" />}
            className="text-zinc-100 hover:bg-white/10"
            onClick={onClose}
          />
        </header>
        <div className="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:px-16 sm:pb-6">
          <img
            key={image.id}
            src={fileUrl(image.id)}
            alt={image.title}
            // The real size, so the box is right before the file arrives; CSS still scales it down.
            {...imageSize(image)}
            className="h-auto max-h-full w-auto max-w-full rounded-lg object-contain"
          />
          {images.length > 1 && (
            <>
              <IconButton
                label="Previous image"
                icon={<ChevronLeft className="size-6" />}
                disabled={!hasPrevious}
                className="absolute top-1/2 left-2 size-11 -translate-y-1/2 rounded-full bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800 disabled:opacity-0"
                onClick={() => onIndexChange(index - 1)}
              />
              <IconButton
                label="Next image"
                icon={<ChevronRight className="size-6" />}
                disabled={!hasNext}
                className="absolute top-1/2 right-2 size-11 -translate-y-1/2 rounded-full bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800 disabled:opacity-0"
                onClick={() => onIndexChange(index + 1)}
              />
            </>
          )}
        </div>
        <p className="sr-only" aria-live="polite">
          {`${image.title}, ${index + 1} of ${images.length}`}
        </p>
      </div>
    </dialog>
  );
}
