import "server-only";
export const demoMode =
  process.env.TABLEPULSE_DEMO === "true" ||
  (process.env.NODE_ENV !== "production" &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL);
export const venueId =
  process.env.TABLEPULSE_VENUE_ID ?? "11111111-1111-4111-8111-111111111111";
export function secret(name: string) {
  const value = process.env[name];
  if (value && value.length >= 32) return value;
  if (demoMode) return `tablepulse-local-demo-${name}-not-for-production`;
  throw new Error(`${name} must be at least 32 characters`);
}
