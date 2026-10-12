/**
 * Application errors. Services and flows throw these; server actions convert them to
 * `ActionResult` failures and route handlers map `status` to the HTTP status code.
 * Messages must be safe to show to the signed-in user (no secrets, no stack traces).
 */

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(message: string, code = "app_error", status = 400, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Please check the highlighted fields.", fieldErrors?: Record<string, string>) {
    super(message, "validation_error", 400, fieldErrors);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super(message, "unauthorized", 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super(message, "forbidden", 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, "not_found", 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "This record changed. Please refresh and try again.") {
    super(message, "conflict", 409);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many attempts. Please wait a moment and try again.") {
    super(message, "rate_limited", 429);
    this.name = "RateLimitError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Throw a NotFoundError when a value is null/undefined; otherwise return it narrowed. */
export function must<T>(value: T | null | undefined, message = "Not found."): T {
  if (value === null || value === undefined) throw new NotFoundError(message);
  return value;
}
