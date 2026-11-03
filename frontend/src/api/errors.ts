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

/** True for answers that retrying won't change, such as 401 or 404. */
export function isClientError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}
