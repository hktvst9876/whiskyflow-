import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { isAppError } from "@/core/errors";
import { logger, errorInfo } from "@/core/logger";
import { fail, ok, type ActionResult } from "@/core/result";
import type { Role } from "@/modules/merchants/types";
import { requireAuth } from "@/modules/auth/session";
import type { AuthContext } from "@/modules/auth/service";
import type { FlowContext } from "@/flows/context";
import { getNow } from "./clock";
import { getDb, type Db } from "./db";

/**
 * Glue for server actions and pages. `withAuth` resolves the signed-in user, the DB, the
 * demo-aware clock and the FlowContext every flow takes. `runAction` turns expected
 * failures (AppError, ZodError) into `ActionResult` values for forms, and lets Next.js
 * control-flow errors (redirect, notFound) through.
 */

export interface AuthedContext {
  auth: AuthContext;
  db: Db;
  now: Date;
  ctx: FlowContext;
}

export async function withAuth(minimum: Role = "staff"): Promise<AuthedContext> {
  const auth = await requireAuth(minimum);
  const db = await getDb();
  const now = await getNow(db);
  return { auth, db, now, ctx: { merchantId: auth.merchantId, actor: { type: auth.role === "staff" ? "staff" : "user", id: auth.userId }, now } };
}

/** Run an action body and convert expected failures into `{ ok: false }`. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error)) return fail(error.message, error.fieldErrors);
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of error.issues) fieldErrors[issue.path.join(".")] = issue.message;
      return fail(error.issues[0]?.message ?? "Please check the highlighted fields.", fieldErrors);
    }
    logger.error("Action failed", errorInfo(error));
    return fail("Something went wrong. Please try again.");
  }
}

/** Map an error to an HTTP response for route handlers (API key / webhook / cron routes). */
export function errorResponse(error: unknown): Response {
  if (isAppError(error)) return Response.json({ error: error.message, code: error.code, fieldErrors: error.fieldErrors }, { status: error.status });
  if (error instanceof ZodError) {
    return Response.json({ error: "Invalid request", code: "validation_error", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  logger.error("Route failed", errorInfo(error));
  return Response.json({ error: "Internal error", code: "internal" }, { status: 500 });
}
