import "server-only";
import { hmacHex, safeEqual } from "@/server/crypto";

/** Verify Meta's `X-Hub-Signature-256: sha256=<hex>` over the raw request body. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = `sha256=${hmacHex(appSecret, rawBody)}`;
  return safeEqual(expected, header);
}
