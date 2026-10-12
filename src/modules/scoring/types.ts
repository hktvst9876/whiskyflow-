/** Return Score, segmentation and playbook types. */

/** Segments in priority order: the first matching segment wins. */
export const SEGMENTS = [
  "high_value",
  "likely_regular",
  "price_sensitive",
  "at_risk",
  "persuadable",
  "new",
  "occasional",
] as const;
export type Segment = (typeof SEGMENTS)[number];

export type ReturnBand = "high" | "medium" | "at_risk";

/** One explanation line for a score ("Visited 4 times in 90 days ↑"). */
export interface ScoreFactor {
  key: string;
  label: string;
  /** Contribution to the logit relative to a neutral customer (positive = more likely). */
  contribution: number;
}

/** Inputs to the Return Score model. All derived from stored facts; no PII. */
export interface ScoreFeatures {
  visitCount: number;
  visits90: number;
  daysSinceLastVisit: number | null;
  typicalGapDays: number | null;
  tenureDays: number;
  /** Customer's average visit spend as a percentile among this merchant's customers (0-1). */
  spendPercentile: number;
  avgPartySize: number;
  /** Retail value of everything the customer still owns here. */
  activeEntitlementValueCents: number;
  daysToNearestExpiry: number | null;
  /** Share of reminders followed by a visit within 14 days; null when never messaged. */
  messageResponseRate: number | null;
  /** Share of visits that used a promotion, perk or discount. */
  promoShare: number;
}

export interface ReturnScore {
  /** Probability of a return visit within the scoring horizon (0-1). */
  probability: number;
  /** 0-100, for display. */
  score: number;
  band: ReturnBand;
  factors: ScoreFactor[];
}

export interface Playbook {
  segment: Segment;
  label: string;
  description: string;
  /** Offer type keys this segment may receive. */
  allowedOfferTypes: string[];
  discountsAllowed: boolean;
  preferredPerks: string[];
  /** Minimum days between marketing touches for this segment. */
  cadenceDays: number;
}

export type NextActionKey =
  | "claim_pending"
  | "expiry_reminder"
  | "win_back"
  | "reminder"
  | "vip"
  | "recognise"
  | "offer_anchor_next_visit"
  | "controlled_offer"
  | "cooldown"
  | "none";

export interface NextAction {
  key: NextActionKey;
  label: string;
  detail: string;
}
