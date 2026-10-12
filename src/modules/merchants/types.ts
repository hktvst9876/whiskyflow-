/** Merchant (tenant) domain types. */

export const VERTICALS = ["restaurant", "bar", "beer_pub", "cafe", "salon", "spa", "fitness", "car_care"] as const;
export type Vertical = (typeof VERTICALS)[number];

export const ROLES = ["owner", "manager", "staff"] as const;
export type Role = (typeof ROLES)[number];

/** Higher number = more privileges. Owners can do everything managers can, and so on. */
export const ROLE_RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };

export function hasRole(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export type MerchantStatus = "active" | "paused";

export interface Merchant {
  id: string;
  name: string;
  slug: string;
  vertical: Vertical;
  /** ISO 4217, e.g. "SGD". */
  currency: string;
  /** IANA zone, e.g. "Asia/Singapore". */
  timezone: string;
  /** BCP 47, e.g. "en-SG". */
  locale: string;
  /** ISO 3166-1 alpha-2, e.g. "SG" (used for phone normalisation and compliance copy). */
  country: string;
  /** Hex colour used on the customer wallet. */
  brandColor: string;
  status: MerchantStatus;
  createdAt: Date;
}

export interface Location {
  id: string;
  merchantId: string;
  name: string;
  address: string | null;
  createdAt: Date;
}

/** Formatting context derived from a merchant; pass to money/date helpers. */
export interface MerchantFormat {
  currency: string;
  locale: string;
  timeZone: string;
}

export function merchantFormat(merchant: Pick<Merchant, "currency" | "locale" | "timezone">): MerchantFormat {
  return { currency: merchant.currency, locale: merchant.locale, timeZone: merchant.timezone };
}
