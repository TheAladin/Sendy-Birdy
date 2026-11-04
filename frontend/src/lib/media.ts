// Thumbnails fit in 640×640 and are never enlarged (backend/app/services/images.py).
const THUMBNAIL_MAX = 640;

interface Dimensions {
  width: number | null;
  height: number | null;
}

/** width/height attributes for an image, so the browser reserves its box before it loads. */
export function imageSize({ width, height }: Dimensions): { width?: number; height?: number } {
  return width && height ? { width, height } : {};
}

/** The same for an item's thumbnail, which keeps the original's proportions. */
export function thumbnailSize(item: Dimensions): { width?: number; height?: number } {
  const { width, height } = item;
  if (!width || !height) return {};
  const scale = Math.min(1, THUMBNAIL_MAX / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Loading hints for the nth image of a grid. The first one is usually the largest thing on
 * screen, so it loads at once and first. The rest are lazy: browsers still fetch the ones on
 * screen right away, but after the first, instead of competing with it for bandwidth.
 */
export function loadingHints(index: number): {
  loading: "eager" | "lazy";
  fetchPriority?: "high";
} {
  return index === 0 ? { loading: "eager", fetchPriority: "high" } : { loading: "lazy" };
}
