import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { secret } from "./config";
export function displayToken(id: string, expiresAt: number) {
  const expiry = Math.floor(expiresAt / 1000);
  return `${id}.${expiry}.${createHmac("sha256", secret("TABLEPULSE_TOKEN_SECRET")).update(`table-display:v1:${id}:${expiry}`).digest("base64url")}`;
}
export function verifyDisplayToken(token: string) {
  const [id, expiry] = token.split(".");
  if (
    !/^[0-9a-f-]{36}$/.test(id) ||
    !/^\d+$/.test(expiry ?? "") ||
    Number(expiry) * 1000 <= Date.now()
  )
    return null;
  const expected = Buffer.from(displayToken(id, Number(expiry) * 1000)),
    actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? id
    : null;
}
