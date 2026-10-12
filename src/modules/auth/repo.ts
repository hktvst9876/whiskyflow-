import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/server/db";
import { merchants } from "../merchants/schema";
import type { Role, Vertical } from "../merchants/types";
import { memberships, rateLimits, sessions, users } from "./schema";

export async function findUserByEmail(db: Db, email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  return row ?? null;
}

export async function insertUser(db: Db, input: { email: string; name: string; passwordHash: string }) {
  const [row] = await db
    .insert(users)
    .values({ email: input.email.trim().toLowerCase(), name: input.name.trim(), passwordHash: input.passwordHash })
    .returning();
  return row!;
}

export async function touchUserLogin(db: Db, userId: string, at: Date) {
  await db.update(users).set({ lastLoginAt: at }).where(eq(users.id, userId));
}

export interface MembershipView {
  merchantId: string;
  merchantName: string;
  merchantSlug: string;
  vertical: Vertical;
  role: Role;
}

export async function listMemberships(db: Db, userId: string): Promise<MembershipView[]> {
  return db
    .select({
      merchantId: merchants.id,
      merchantName: merchants.name,
      merchantSlug: merchants.slug,
      vertical: merchants.vertical,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(merchants, eq(merchants.id, memberships.merchantId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(merchants.name));
}

export async function insertMembership(db: Db, input: { userId: string; merchantId: string; role: Role }) {
  await db.insert(memberships).values(input).onConflictDoUpdate({
    target: [memberships.userId, memberships.merchantId],
    set: { role: input.role },
  });
}

export async function insertSession(
  db: Db,
  input: { tokenHash: string; userId: string; merchantId: string | null; expiresAt: Date; userAgent: string | null; at: Date },
) {
  const [row] = await db
    .insert(sessions)
    .values({ ...input, createdAt: input.at, lastSeenAt: input.at })
    .returning();
  return row!;
}

export async function findSessionWithUser(db: Db, tokenHash: string) {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash));
  return row ?? null;
}

export async function touchSession(db: Db, sessionId: string, at: Date) {
  await db.update(sessions).set({ lastSeenAt: at }).where(eq(sessions.id, sessionId));
}

export async function setSessionMerchant(db: Db, sessionId: string, merchantId: string) {
  await db.update(sessions).set({ merchantId }).where(eq(sessions.id, sessionId));
}

export async function deleteSession(db: Db, tokenHash: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/**
 * Fixed-window rate limit. Returns whether this attempt is allowed. Fixed windows can let
 * a burst through at a boundary; acceptable for login/claim throttling.
 */
export async function consumeRateLimit(db: Db, key: string, limit: number, windowSeconds: number, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(rateLimits).where(eq(rateLimits.key, key)).for("update");
    const windowStart = now.getTime() - windowSeconds * 1000;
    if (!row || row.windowStart.getTime() < windowStart) {
      await tx
        .insert(rateLimits)
        .values({ key, windowStart: now, count: 1 })
        .onConflictDoUpdate({ target: rateLimits.key, set: { windowStart: now, count: 1 } });
      return true;
    }
    if (row.count >= limit) return false;
    await tx.update(rateLimits).set({ count: row.count + 1 }).where(and(eq(rateLimits.key, key)));
    return true;
  });
}
