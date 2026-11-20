// Maps typed destination errors (400/403/429/503) onto the HTTP response of a
// server function. The error itself is still thrown so callers keep its code
// and message; only the transport status (and Retry-After) is set.
import { setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";
import { CmsDestinationError } from "./cms-destination.server";

export function applyCmsErrorHttpStatus(err: unknown): void {
  if (!(err instanceof CmsDestinationError)) return;
  try {
    setResponseStatus(err.status);
    if (err.status === 429 && err.retryAfterSec) {
      setResponseHeader("Retry-After", String(Math.ceil(err.retryAfterSec)));
    }
  } catch {
    // Not inside an HTTP request (e.g. unit tests): nothing to set.
  }
}

/** Runs a guard and sets the HTTP status of a CmsDestinationError before rethrowing it. */
export async function withCmsHttpStatus<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    applyCmsErrorHttpStatus(err);
    throw err;
  }
}
