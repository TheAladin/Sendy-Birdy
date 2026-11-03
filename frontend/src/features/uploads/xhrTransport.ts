import type { Transport } from "./queue";

function messageFor(xhr: XMLHttpRequest): string {
  if (xhr.status === 401) return "Your session ended. Sign in again, then retry.";
  try {
    const body = JSON.parse(xhr.responseText) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Not JSON: fall through to a generic message.
  }
  return `Upload failed (HTTP ${xhr.status}).`;
}

/**
 * Sends the raw file as the request body (the API streams it with a size limit).
 * XMLHttpRequest rather than fetch, because only XHR reports upload progress.
 */
export const xhrTransport: Transport = (file, name, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/items?filename=${encodeURIComponent(name)}`);
    xhr.setRequestHeader("X-Requested-With", "fetch");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 201) resolve(JSON.parse(xhr.responseText) as unknown);
      else reject(new Error(messageFor(xhr)));
    };
    xhr.onerror = () =>
      reject(new Error("The upload didn't reach the server. Check the connection."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
