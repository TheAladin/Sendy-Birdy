import { vi } from "vitest";

type Handler = (request: Request) => Response | Promise<Response>;

/**
 * Replaces fetch with a fake backend: keys are "METHOD /path", values build the response.
 * Unknown requests fail the test with a clear message. Returns the spy to inspect calls.
 */
export function mockApi(handlers: Record<string, Handler>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const request = input as Request;
    const key = `${request.method} ${new URL(request.url).pathname}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request in test: ${key}`);
    return handler(request);
  });
}

export const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, headers });
