import { formatBytes } from "../../lib/format";

export type UploadStatus = "queued" | "uploading" | "done" | "failed" | "cancelled";

export interface Upload {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** 0 to 1. */
  progress: number;
  error?: string;
  /** False when retrying can't help (wrong type, too big). */
  retryable: boolean;
}

export interface UploadLimits {
  maxBytes: number;
  acceptedTypes: string[];
}

/** Sends one file; reports progress; rejects with an Error whose message is shown to the user. */
export type Transport = (
  file: File,
  name: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
) => Promise<unknown>;

interface Options {
  concurrency?: number;
  onUploaded?: () => void;
}

/**
 * Uploads files a few at a time, tracking progress, and supports cancel and retry.
 * Framework-free: React subscribes to it with useSyncExternalStore.
 */
export class UploadQueue {
  private uploads: Upload[] = [];
  private readonly files = new Map<string, File>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Set<() => void>();
  private readonly transport: Transport;
  private readonly concurrency: number;
  private readonly onUploaded?: () => void;
  private limits?: UploadLimits;
  private nextId = 0;

  constructor(transport: Transport, { concurrency = 3, onUploaded }: Options = {}) {
    this.transport = transport;
    this.concurrency = concurrency;
    this.onUploaded = onUploaded;
  }

  setLimits(limits: UploadLimits) {
    this.limits = limits;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.uploads;

  /** Queue files; ones the server would refuse are marked failed straight away. */
  add(files: Iterable<File>, nameFor: (file: File) => string = (file) => file.name) {
    for (const file of files) {
      const id = `upload-${this.nextId++}`;
      const problem = this.check(file);
      this.files.set(id, file);
      this.uploads = [
        ...this.uploads,
        {
          id,
          name: nameFor(file),
          size: file.size,
          status: problem ? "failed" : "queued",
          progress: 0,
          error: problem,
          retryable: !problem,
        },
      ];
    }
    this.emit();
    this.pump();
  }

  cancel(id: string) {
    const upload = this.find(id);
    if (upload?.status === "queued") this.update(id, { status: "cancelled" });
    if (upload?.status === "uploading") this.controllers.get(id)?.abort();
  }

  retry(id: string) {
    const upload = this.find(id);
    if (!upload?.retryable || (upload.status !== "failed" && upload.status !== "cancelled")) return;
    this.update(id, { status: "queued", progress: 0, error: undefined });
    this.pump();
  }

  /** Forget finished, failed and cancelled uploads. */
  clearFinished() {
    const active = new Set<UploadStatus>(["queued", "uploading"]);
    for (const upload of this.uploads) {
      if (!active.has(upload.status)) this.files.delete(upload.id);
    }
    this.uploads = this.uploads.filter((upload) => active.has(upload.status));
    this.emit();
  }

  private check(file: File): string | undefined {
    if (!this.limits) return undefined;
    if (file.type && !this.limits.acceptedTypes.includes(file.type)) {
      return "Not a supported file type.";
    }
    if (file.size > this.limits.maxBytes) {
      return `Larger than the ${formatBytes(this.limits.maxBytes)} limit.`;
    }
    if (file.size === 0) return "The file is empty.";
    return undefined;
  }

  private pump() {
    let running = this.uploads.filter((upload) => upload.status === "uploading").length;
    for (const upload of this.uploads) {
      if (running >= this.concurrency) break;
      if (upload.status !== "queued") continue;
      running += 1;
      void this.start(upload);
    }
  }

  private async start(upload: Upload) {
    const file = this.files.get(upload.id);
    if (!file) return;
    const controller = new AbortController();
    this.controllers.set(upload.id, controller);
    this.update(upload.id, { status: "uploading", progress: 0 });
    try {
      await this.transport(
        file,
        upload.name,
        (progress) => this.update(upload.id, { progress }),
        controller.signal,
      );
      this.update(upload.id, { status: "done", progress: 1 });
      this.files.delete(upload.id);
      this.onUploaded?.();
    } catch (error) {
      this.update(
        upload.id,
        controller.signal.aborted
          ? { status: "cancelled" }
          : { status: "failed", error: error instanceof Error ? error.message : "Upload failed." },
      );
    } finally {
      this.controllers.delete(upload.id);
      this.pump();
    }
  }

  private find(id: string) {
    return this.uploads.find((upload) => upload.id === id);
  }

  private update(id: string, changes: Partial<Upload>) {
    this.uploads = this.uploads.map((upload) =>
      upload.id === id ? { ...upload, ...changes } : upload,
    );
    this.emit();
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}
