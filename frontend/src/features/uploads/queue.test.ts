import { describe, expect, test, vi } from "vitest";

import { type Transport, UploadQueue } from "./queue";

/** A fake transport whose uploads finish only when the test says so. */
function controllableTransport() {
  const pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; progress: (n: number) => void }
  >();
  const signals = new Map<string, AbortSignal>();
  const transport: Transport = (_file, name, onProgress, signal) =>
    new Promise((resolve, reject) => {
      signals.set(name, signal);
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      pending.set(name, { resolve: () => resolve(undefined), reject, progress: onProgress });
    });
  return { transport, pending, signals };
}

const file = (name: string, size = 10, type = "image/png") =>
  new File([new Uint8Array(size)], name, { type });

const statuses = (queue: UploadQueue) =>
  Object.fromEntries(queue.getSnapshot().map((upload) => [upload.name, upload.status]));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("UploadQueue", () => {
  test("runs at most three uploads at once and starts the next when one finishes", async () => {
    const { transport, pending } = controllableTransport();
    const queue = new UploadQueue(transport);

    queue.add(["a", "b", "c", "d", "e"].map((name) => file(name)));

    expect(Object.values(statuses(queue)).filter((s) => s === "uploading")).toHaveLength(3);
    expect(statuses(queue).d).toBe("queued");
    pending.get("a")?.resolve();
    await settle();
    expect(statuses(queue)).toMatchObject({ a: "done", d: "uploading", e: "queued" });
  });

  test("reports progress, then completion, and tells the app to refresh", async () => {
    const { transport, pending } = controllableTransport();
    const onUploaded = vi.fn();
    const queue = new UploadQueue(transport, { onUploaded });
    const listener = vi.fn();
    queue.subscribe(listener);

    queue.add([file("shot.png")]);
    pending.get("shot.png")?.progress(0.4);
    expect(queue.getSnapshot()[0]?.progress).toBe(0.4);
    pending.get("shot.png")?.resolve();
    await settle();

    expect(queue.getSnapshot()[0]).toMatchObject({ status: "done", progress: 1 });
    expect(onUploaded).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalled();
  });

  test("a failed upload shows the server's message and can be retried", async () => {
    const { transport, pending } = controllableTransport();
    const queue = new UploadQueue(transport);

    queue.add([file("shot.png")]);
    pending.get("shot.png")?.reject(new Error("This image is damaged or incomplete."));
    await settle();
    expect(queue.getSnapshot()[0]).toMatchObject({
      status: "failed",
      error: "This image is damaged or incomplete.",
      retryable: true,
    });

    queue.retry(queue.getSnapshot()[0].id);
    expect(statuses(queue)["shot.png"]).toBe("uploading");
    pending.get("shot.png")?.resolve();
    await settle();
    expect(statuses(queue)["shot.png"]).toBe("done");
  });

  test("cancelling stops a running upload and frees its slot", async () => {
    const { transport, signals } = controllableTransport();
    const queue = new UploadQueue(transport, { concurrency: 1 });
    queue.add([file("big.mp4"), file("next.png")]);

    queue.cancel(queue.getSnapshot()[0].id);
    await settle();

    expect(signals.get("big.mp4")?.aborted).toBe(true);
    expect(statuses(queue)).toEqual({ "big.mp4": "cancelled", "next.png": "uploading" });
  });

  test("cancelling a waiting upload means it never starts", () => {
    const { transport } = controllableTransport();
    const queue = new UploadQueue(transport, { concurrency: 1 });
    queue.add([file("first.png"), file("second.png")]);

    queue.cancel(queue.getSnapshot()[1].id);

    expect(statuses(queue)["second.png"]).toBe("cancelled");
  });

  test("files the server would refuse fail immediately, without uploading", () => {
    const transport = vi.fn<Transport>();
    const queue = new UploadQueue(transport);
    queue.setLimits({ maxBytes: 100, acceptedTypes: ["image/png"] });

    queue.add([
      file("doc.pdf", 10, "application/pdf"),
      file("huge.png", 500),
      file("blank.png", 0),
    ]);

    expect(queue.getSnapshot().map((u) => [u.status, u.error, u.retryable])).toEqual([
      ["failed", "Not a supported file type.", false],
      ["failed", "Larger than the 100 B limit.", false],
      ["failed", "The file is empty.", false],
    ]);
    expect(transport).not.toHaveBeenCalled();
    queue.retry(queue.getSnapshot()[0].id);
    expect(transport).not.toHaveBeenCalled();
  });

  test("clearing removes finished uploads but keeps running ones", async () => {
    const { transport, pending } = controllableTransport();
    const queue = new UploadQueue(transport);
    queue.add([file("done.png"), file("running.png")]);
    pending.get("done.png")?.resolve();
    await settle();

    queue.clearFinished();

    expect(statuses(queue)).toEqual({ "running.png": "uploading" });
  });
});
