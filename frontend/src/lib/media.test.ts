import { expect, test } from "vitest";

import { imageSize, loadingHints, thumbnailSize } from "./media";

test("thumbnails keep the original's proportions within 640 px", () => {
  expect(thumbnailSize({ width: 1920, height: 1080 })).toEqual({ width: 640, height: 360 });
  expect(thumbnailSize({ width: 800, height: 1600 })).toEqual({ width: 320, height: 640 });
  // Small images aren't enlarged.
  expect(thumbnailSize({ width: 300, height: 200 })).toEqual({ width: 300, height: 200 });
  expect(thumbnailSize({ width: null, height: null })).toEqual({});
});

test("full-size images use their own dimensions when known", () => {
  expect(imageSize({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 });
  expect(imageSize({ width: null, height: 1080 })).toEqual({});
});

test("only the first image loads eagerly, with priority", () => {
  expect(loadingHints(0)).toEqual({ loading: "eager", fetchPriority: "high" });
  expect(loadingHints(1)).toEqual({ loading: "lazy" });
});
