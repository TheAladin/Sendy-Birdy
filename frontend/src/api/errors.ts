export class ApiError extends Error {
  readonly status: number;
  /** From the Retry-After header on 429 responses. */
  readonly retryAfterSeconds?: number;

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function apiError(response: Response): ApiError {
  const retryAfter = Number(response.headers.get("Retry-After"));
  return new ApiError(
    response.status,
    `Request failed with HTTP ${response.status}`,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

/**
 * Like apiError, but keeps the server's own message: FastAPI's "detail" string, or the first
 * validation message of a 422. `body` is the error body openapi-fetch already parsed; the
 * response itself can't be read twice.
 */
export function apiErrorFrom(response: Response, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  const message = Array.isArray(detail)
    ? (detail[0] as { msg?: string } | undefined)?.msg?.replace(/^Value error, /, "")
    : detail;
  return typeof message === "string" ? new ApiError(response.status, message) : apiError(response);
}

/** True for answers that retrying won't change, such as 401 or 404. */
export function isClientError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}
