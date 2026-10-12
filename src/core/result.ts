/**
 * Result type returned by server actions to client components. Never throw across the
 * action boundary for expected failures — return `fail(...)` instead.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string, fieldErrors?: Record<string, string>): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

/** Initial state for `useActionState` with an ActionResult-returning action. */
export const initialActionState = null as ActionResult<unknown> | null;
