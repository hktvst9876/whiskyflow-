/**
 * Phone number helpers (E.164). Deliberately small: we normalise and validate the shape
 * so WhatsApp can deliver; we do not attempt full numbering-plan validation.
 */

/** Country calling codes for countries we expect merchants in. Extend as needed. */
export const CALLING_CODES: Record<string, string> = {
  SG: "65",
  MY: "60",
  ID: "62",
  TH: "66",
  PH: "63",
  VN: "84",
  HK: "852",
  AU: "61",
  NZ: "64",
  GB: "44",
  IE: "353",
  US: "1",
  CA: "1",
  IN: "91",
  AE: "971",
};

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Normalise user input to E.164 ("+6581234567"). Accepts "+65 8123 4567", "0065…",
 * or a local number which gets the merchant's country code. Returns null when invalid.
 */
export function normalisePhone(input: string, defaultCountry = "SG"): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[\s().-]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) {
    const code = CALLING_CODES[defaultCountry.toUpperCase()];
    if (!code) return null;
    // Drop a single trunk prefix "0" used in many countries for local dialling.
    const local = digits.replace(/^0/, "");
    digits = `+${code}${local}`;
  }
  return E164.test(digits) ? digits : null;
}

export function isE164(value: string): boolean {
  return E164.test(value);
}

/** Mask for staff screens and logs: "+6581234567" → "+65 •••• 4567". */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const last4 = e164.slice(-4);
  const code = Object.values(CALLING_CODES)
    .sort((a, b) => b.length - a.length)
    .find((c) => e164.startsWith(`+${c}`));
  return `${code ? `+${code} ` : ""}•••• ${last4}`;
}

/** Digits only, for wa.me links: "+6581234567" → "6581234567". */
export function waDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}
