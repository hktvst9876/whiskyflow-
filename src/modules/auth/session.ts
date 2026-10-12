import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "@/config/env";
import { ForbiddenError } from "@/core/errors";
import { getDb } from "@/server/db";
import { hasRole, type Role } from "../merchants/types";
import { resolveSession, type AuthContext } from "./service";

/**
 * Next.js glue for sessions. Every page, query and action calls `requireAuth()` itself;
 * layouts are not a security boundary.
 */
export const SESSION_COOKIE = "ra_session";

/** The signed-in user for this request, or null. Cached per request. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveSession(await getDb(), token);
});

/** Require a signed-in user with at least `minimum` role. Redirects to /login when signed out. */
export async function requireAuth(minimum: Role = "staff"): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasRole(auth.role, minimum)) throw new ForbiddenError(`This needs ${minimum} access.`);
  return auth;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().appUrl.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function readSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** A coarse client identifier for rate limiting (IP when behind a proxy that sets it). */
export async function clientKey(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local").slice(0, 64);
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}
