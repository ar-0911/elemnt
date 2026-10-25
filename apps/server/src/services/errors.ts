import type { Diagnostic } from "@elemnt/core";

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 502,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class InvalidSourceError extends HttpError {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(422, "The page has errors. Fix them and save again.", { diagnostics });
  }
}
