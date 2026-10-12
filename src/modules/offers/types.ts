/** Offer, decision and exposure domain types. */

import type { Arm } from "../experiments/types";
import type { DealCandidate } from "../deals/types";

/**
 * Offer type keys. `anchor_upgrade` is produced by the deal engine at checkout; the rest
 * are merchant-defined offers used in reminders, campaigns and at redemption.
 */
export const OFFER_TYPE_KEYS = [
  "anchor_upgrade",
  "stored_addon",
  "food_drink_attach",
  "bring_a_friend",
  "new_menu",
  "off_peak_perk",
  "premium_upgrade",
  "renewal_bonus",
  "win_back_perk",
  "priority_booking",
] as const;
export type OfferTypeKey = (typeof OFFER_TYPE_KEYS)[number];

export type OfferChannel = "pos" | "whatsapp" | "wallet" | "staff_upsell";
export type ExposureStatus = "shown" | "accepted" | "declined" | "expired" | "redeemed";
export type DecisionOutcome = "offered" | "holdout" | "no_eligible" | "blocked";
export type OfferDefinitionStatus = "active" | "paused" | "archived";

/** Merchant-configured offer. `config` shape depends on `offerType` (see `offers/types/*`). */
export interface OfferDefinition {
  id: string;
  merchantId: string;
  offerType: OfferTypeKey;
  name: string;
  status: OfferDefinitionStatus;
  isDiscount: boolean;
  config: Record<string, unknown>;
  estCostCents: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Snapshot of the checkout context stored with each decision (for audit and analysis). */
export interface DecisionContext {
  basketRevenueCents: number;
  basketCostCents: number;
  partySize: number;
  segment: string | null;
  p0: number;
  identified: boolean;
  guardrails?: { key: string; passed: boolean; reason: string }[];
}

export interface OfferDecision {
  id: string;
  merchantId: string;
  visitId: string;
  customerId: string | null;
  experimentId: string | null;
  arm: Arm | null;
  identifiedAtAssignment: boolean;
  outcome: DecisionOutcome;
  chosen: DealCandidate | null;
  candidates: DealCandidate[];
  context: DecisionContext;
  policyVersion: string;
  createdAt: Date;
}

export interface OfferExposure {
  id: string;
  merchantId: string;
  decisionId: string | null;
  offerDefinitionId: string | null;
  visitId: string | null;
  customerId: string | null;
  campaignId: string | null;
  messageId: string | null;
  entitlementId: string | null;
  offerType: OfferTypeKey;
  channel: OfferChannel;
  isDiscount: boolean;
  payload: Record<string, unknown>;
  expected: Record<string, unknown>;
  status: ExposureStatus;
  promoCostCents: number;
  valueCents: number;
  shownAt: Date;
  respondedAt: Date | null;
  expiresAt: Date | null;
}

/** Minimal exposure facts used by guardrails. */
export interface ExposureFact {
  offerType: OfferTypeKey;
  isDiscount: boolean;
  status: ExposureStatus;
  channel: OfferChannel;
  promoCostCents: number;
  shownAt: Date;
}
