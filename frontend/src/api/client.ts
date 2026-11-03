import createClient from "openapi-fetch";

import type { paths } from "./schema";

export const api = createClient<paths>({
  baseUrl: globalThis.location.origin,
  // The backend refuses data-changing requests without this header (CSRF protection).
  headers: { "X-Requested-With": "fetch" },
  // Looked up on every call rather than captured once, so tests can replace fetch.
  fetch: (request) => globalThis.fetch(request),
});
