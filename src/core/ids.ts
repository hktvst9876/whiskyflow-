/**
 * Identifiers, short human codes and random tokens. Uses Web Crypto, so it works on the
 * server and in the browser.
 */

/** A random UUID v4 (database primary keys default to gen_random_uuid() as well). */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** Unambiguous alphabet for codes people read aloud or type (no 0/O, 1/I/L). */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Cryptographically random code from CODE_ALPHABET without modulo bias. */
export function randomCode(length = 8, alphabet = CODE_ALPHABET): string {
  const out: string[] = [];
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  while (out.length < length) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < max) out.push(alphabet[b % alphabet.length]!);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

/** Random URL-safe token (default 24 bytes ≈ 192 bits → 32 characters). */
export function randomToken(bytes = 24): string {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Format a redeem code for display: "ABCD2345" → "ABCD-2345". */
export function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** Normalise user-typed codes: uppercase, strip spaces and dashes. */
export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}
