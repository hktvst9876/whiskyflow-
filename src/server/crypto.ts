import "server-only";
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { env } from "@/config/env";

/**
 * Secrets: password hashing, token hashing and HMAC-derived tokens.
 * Tokens are never stored in plain text; the database keeps SHA-256 hashes.
 */

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Hash a password as "scrypt$N$r$p$saltB64$hashB64". */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** SHA-256 hex of a token, for storage and lookup. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** HMAC-SHA256 (hex) with an explicit key. */
export function hmacHex(key: string, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

/**
 * Deterministic token for a purpose and record id: base64url(HMAC(APP_SECRET, purpose:id)).
 * Lets us re-create a customer's wallet/claim link from the id without storing the token.
 * Rotating APP_SECRET invalidates all such links.
 */
export function derivedToken(purpose: "wallet" | "claim", id: string, length = 32): string {
  return createHmac("sha256", env().appSecret).update(`${purpose}:${id}`).digest("base64url").slice(0, length);
}

/** Random token (base64url) for sessions and API keys. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
