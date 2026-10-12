/** Customer domain types. Customers are scoped to one merchant in the MVP. */

import type { ReturnBand, ScoreFactor, Segment } from "../scoring/types";

export type CustomerStatus = "active" | "anonymised";

export interface Customer {
  id: string;
  merchantId: string;
  phoneE164: string | null;
  displayName: string | null;
  /** Short code encoded in the wallet QR; staff use it to look the customer up. */
  redeemCode: string;
  status: CustomerStatus;
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  visitCount: number;
  totalSpendCents: number;
  totalGpCents: number;
  avgPartySize: number;
  /** 0 = Sunday … 6 = Saturday */
  preferredWeekday: number | null;
  /** Local hour 0-23 */
  preferredHour: number | null;
  /** Typical days between visits (median gap), null until 2+ visits. */
  typicalGapDays: number | null;
  whatsappServiceOptIn: boolean;
  whatsappMarketingOptIn: boolean;
  optedOutAt: Date | null;
  /** 0-1 probability of returning within the scoring horizon. */
  returnProbability: number | null;
  returnBand: ReturnBand | null;
  segment: Segment | null;
  scoreFactors: ScoreFactor[] | null;
  scoredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ConsentPurpose = "service_messages" | "marketing_messages" | "terms";
export type ConsentSource = "claim_page" | "staff" | "whatsapp" | "wallet" | "import" | "console";

export interface CustomerConsent {
  id: string;
  merchantId: string;
  customerId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: ConsentSource;
  noticeVersion: string;
  createdAt: Date;
}

/** Minimal visit facts used to recompute customer aggregates (pure). */
export interface VisitFact {
  openedAt: Date;
  partySize: number;
  spendCents: number;
  gpCents: number;
  /** True when the visit used a promotion/discount/perk (for price-sensitivity). */
  promo: boolean;
}

export interface CustomerAggregates {
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  visitCount: number;
  totalSpendCents: number;
  totalGpCents: number;
  avgPartySize: number;
  preferredWeekday: number | null;
  preferredHour: number | null;
  typicalGapDays: number | null;
}
