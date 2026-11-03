import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { json, LIMITS, mockApi } from "../../test/api";
import { renderRoute } from "../../test/render";
import { nameForUpload } from "./context";

const USER = { id: "u1", email: "me@example.com", display_name: "Alex" };

/** A stand-in for XMLHttpRequest that records requests and lets tests answer them. */
class FakeXhr {
  static instances: FakeXhr[] = [];
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = "";
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

let itemsRequests = 0;

beforeEach(() => {
  FakeXhr.instances = [];
  itemsRequests = 0;
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  mockApi({
    "GET /api/auth/me": () => json(USER),
    "GET /api/items": () => {
      itemsRequests += 1;
      return json({ items: [], next_cursor: null });
    },
    "GET /api/items/upload-limits": () => json(LIMITS),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const png = (name = "hero.png", size = 1000) =>
  new File([new Uint8Array(size)], name, { type: "image/png" });

async function openLibrary() {
  renderRoute("/");
  await screen.findByRole("heading", { name: "Library" });
  // Let the upload limits arrive before adding files.
  await waitFor(() => expect(itemsRequests).toBeGreaterThan(0));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function filePicker() {
  return document.querySelector<HTMLInputElement>('input[type="file"]')!;
}

test("choosing a file uploads its raw bytes with progress, then refreshes the library", async () => {
  await openLibrary();
  const file = png("Hero shot.png");

  await userEvent.upload(filePicker(), file);

  const xhr = FakeXhr.instances[0];
  expect(xhr.method).toBe("POST");
  expect(xhr.url).toBe("/api/items?filename=Hero%20shot.png");
  expect(xhr.headers["X-Requested-With"]).toBe("fetch");
  expect(xhr.body).toBe(file);

  act(() => xhr.progress(400, 1000));
  const panel = screen.getByRole("region", { name: "Uploads" });
  expect(within(panel).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  expect(within(panel).getByText("Uploading 1 file…")).toBeInTheDocument();

  const before = itemsRequests;
  act(() => xhr.respond(201, { id: "new" }));
  expect(await within(panel).findByText("Uploaded")).toBeInTheDocument();
  expect(within(panel).getByText("Uploads finished")).toBeInTheDocument();
  await waitFor(() => expect(itemsRequests).toBeGreaterThan(before));
});

test("the server's error message is shown, and the upload can be retried", async () => {
  await openLibrary();
  await userEvent.upload(filePicker(), png());

  act(() => FakeXhr.instances[0].respond(422, { detail: "This image is damaged or incomplete." }));
  const panel = screen.getByRole("region", { name: "Uploads" });
  expect(await within(panel).findByText("This image is damaged or incomplete.")).toBeVisible();

  await userEvent.click(within(panel).getByRole("button", { name: "Retry hero.png" }));
  expect(FakeXhr.instances).toHaveLength(2);
});

test("files that are too big are refused before anything is sent", async () => {
  await openLibrary();

  await userEvent.upload(filePicker(), png("huge.png", LIMITS.max_bytes + 1));

  const panel = screen.getByRole("region", { name: "Uploads" });
  expect(within(panel).getByText("Larger than the 5.0 MB limit.")).toBeInTheDocument();
  expect(within(panel).queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  expect(FakeXhr.instances).toHaveLength(0);
});

test("an upload can be cancelled while it runs", async () => {
  await openLibrary();
  await userEvent.upload(filePicker(), png());

  await userEvent.click(screen.getByRole("button", { name: "Cancel hero.png" }));

  expect(await screen.findByText("Cancelled")).toBeInTheDocument();
});

function pasteEvent(files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files } });
  return event;
}

test("pasting a screenshot uploads it with a readable name", async () => {
  await openLibrary();

  act(() => {
    document.body.dispatchEvent(pasteEvent([png("image.png")]));
  });

  expect(FakeXhr.instances[0]?.url).toMatch(
    /^\/api\/items\?filename=Screenshot%20\d{4}-\d\d-\d\d%20at%20\d\d\.\d\d\.\d\d\.png$/,
  );
});

test("pasting into the search box pastes text instead of uploading", async () => {
  await openLibrary();

  act(() => {
    screen.getByRole("searchbox").dispatchEvent(pasteEvent([png("image.png")]));
  });

  expect(FakeXhr.instances).toHaveLength(0);
});

test("dragging files over the page shows a drop target, and dropping uploads them", async () => {
  await openLibrary();
  const files = [png("a.png"), png("b.png")];
  const dataTransfer = { types: ["Files"], files };

  fireEvent.dragEnter(window, { dataTransfer });
  expect(screen.getByText("Drop to upload")).toBeInTheDocument();
  fireEvent.drop(window, { dataTransfer });

  expect(screen.queryByText("Drop to upload")).not.toBeInTheDocument();
  expect(FakeXhr.instances.map((xhr) => xhr.url)).toEqual([
    "/api/items?filename=a.png",
    "/api/items?filename=b.png",
  ]);
});

test("pasted screenshots get a dated name; real file names are kept", () => {
  const moment = new Date(2026, 10, 2, 14, 5, 9);

  expect(nameForUpload(png("image.png"), moment)).toBe("Screenshot 2026-11-02 at 14.05.09.png");
  expect(nameForUpload(png("Checkout v2.png"), moment)).toBe("Checkout v2.png");
});

test("the newest upload is listed first, so a failure is never hidden below older ones", async () => {
  await openLibrary();

  await userEvent.upload(filePicker(), [png("first.png"), png("second.png", LIMITS.max_bytes + 1)]);

  const rows = within(screen.getByRole("region", { name: "Uploads" })).getAllByRole("listitem");
  expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([
    "second.png",
    "first.png",
  ]);
});
