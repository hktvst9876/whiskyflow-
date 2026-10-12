import "server-only";
import { RateLimitError, ValidationError } from "@/core/errors";
import { hashPassword, randomSecret, sha256, verifyPassword } from "@/server/crypto";
import type { Db } from "@/server/db";
import { getMerchant } from "../merchants/repo";
import { hasRole, type Merchant, type Role } from "../merchants/types";
import {
  consumeRateLimit,
  deleteSession,
  findSessionWithUser,
  findUserByEmail,
  insertSession,
  insertUser,
  listMemberships,
  setSessionMerchant,
  touchSession,
  touchUserLogin,
  type MembershipView,
} from "./repo";

/** Sessions last 14 days; activity within the last day keeps them alive. */
export const SESSION_DAYS = 14;
const LOGIN_ATTEMPTS_PER_15_MIN = 10;

// A real scrypt hash, so unknown emails take as long as wrong passwords (no user enumeration).
let dummyHash: Promise<string> | null = null;

export interface AuthContext {
  sessionId: string;
  userId: string;
  userName: string;
  email: string;
  merchant: Merchant;
  merchantId: string;
  role: Role;
  memberships: MembershipView[];
}

export async function createUser(db: Db, input: { email: string; name: string; password: string }) {
  if (input.password.length < 8) throw new ValidationError("Use at least 8 characters.", { password: "Use at least 8 characters." });
  if (await findUserByEmail(db, input.email)) throw new ValidationError("An account with this email already exists.", { email: "Already registered." });
  return insertUser(db, { email: input.email, name: input.name, passwordHash: await hashPassword(input.password) });
}

/** Check credentials (rate-limited per email and per client). Returns the user or throws. */
export async function authenticate(db: Db, input: { email: string; password: string; clientKey: string; now: Date }) {
  const email = input.email.trim().toLowerCase();
  const allowed =
    (await consumeRateLimit(db, `login:email:${email}`, LOGIN_ATTEMPTS_PER_15_MIN, 900, input.now)) &&
    (await consumeRateLimit(db, `login:client:${input.clientKey}`, LOGIN_ATTEMPTS_PER_15_MIN * 3, 900, input.now));
  if (!allowed) throw new RateLimitError();
  const user = await findUserByEmail(db, email);
  if (!user) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(input.password, await dummyHash);
    throw new ValidationError("Email or password is incorrect.");
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) throw new ValidationError("Email or password is incorrect.");
  await touchUserLogin(db, user.id, input.now);
  return user;
}

/** Create a session; returns the raw token for the cookie (only its hash is stored). */
export async function startSession(db: Db, input: { userId: string; userAgent: string | null; now: Date }) {
  const memberships = await listMemberships(db, input.userId);
  const token = randomSecret(32);
  const expiresAt = new Date(input.now.getTime() + SESSION_DAYS * 86_400_000);
  await insertSession(db, {
    tokenHash: sha256(token),
    userId: input.userId,
    merchantId: memberships[0]?.merchantId ?? null,
    expiresAt,
    userAgent: input.userAgent?.slice(0, 200) ?? null,
    at: input.now,
  });
  return { token, expiresAt };
}

export async function endSession(db: Db, token: string) {
  await deleteSession(db, sha256(token));
}

/**
 * Resolve a session token to the signed-in user and their active merchant/role.
 * Sessions use real time (not the demo clock) so time travel never logs people out.
 */
export async function resolveSession(db: Db, token: string): Promise<AuthContext | null> {
  const found = await findSessionWithUser(db, sha256(token));
  if (!found) return null;
  const { session, user } = found;
  const realNow = new Date();
  if (session.expiresAt.getTime() <= realNow.getTime()) return null;
  const memberships = await listMemberships(db, user.id);
  const active = memberships.find((m) => m.merchantId === session.merchantId) ?? memberships[0];
  if (!active) return null;
  if (realNow.getTime() - session.lastSeenAt.getTime() > 3_600_000) await touchSession(db, session.id, realNow);
  return {
    sessionId: session.id,
    userId: user.id,
    userName: user.name,
    email: user.email,
    merchant: await getMerchant(db, active.merchantId),
    merchantId: active.merchantId,
    role: active.role,
    memberships,
  };
}

export async function switchMerchant(db: Db, auth: AuthContext, merchantId: string) {
  if (!auth.memberships.some((m) => m.merchantId === merchantId)) throw new ValidationError("You are not a member of that business.");
  await setSessionMerchant(db, auth.sessionId, merchantId);
}

export function roleAllows(auth: Pick<AuthContext, "role">, minimum: Role) {
  return hasRole(auth.role, minimum);
}
