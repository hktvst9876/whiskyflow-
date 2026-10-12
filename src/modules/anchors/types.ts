/**
 * Return Anchor domain types.
 *
 * - An **AnchorProgram** is the merchant's rule for what can be stored and on what terms
 *   ("3-Main Set — keep 1 main", "Bottle keep", "Beer locker", "3-massage package").
 * - An **Entitlement** is one customer's owned, unfinished value ("1 Main Waiting").
 * - **EntitlementEvents** form an append-only ledger; `quantityRemaining` on the
 *   entitlement is a denormalised balance kept in sync inside the same transaction.
 */

/** item = countable things (mains, pints); percent = bottle level 0-100; session = services. */
export type AnchorUnitType = "item" | "percent" | "session";

/**
 * upgrade_offer: created by the deal engine at checkout ("+$8 → keep 1 main").
 * stored_purchase: something already bought is partly left over (bottle keep, beer bucket).
 */
export type AnchorIssueMode = "upgrade_offer" | "stored_purchase";

export type AnchorProgramStatus = "active" | "paused" | "archived";

export type AnchorCoverage =
  | {
      kind: "category";
      category: string;
      /** "Covers dishes up to $24". Null/undefined = any item in the category. */
      maxCoveredPriceCents?: number | null;
    }
  | { kind: "items"; itemIds: string[] };

/** When the deal engine may consider a program for the current basket. */
export interface AnchorTrigger {
  minBasketCents?: number;
  /** e.g. { main: 2, side: 2 } = at least 2 mains and 2 sides already ordered. */
  requiredCategoryCounts?: Record<string, number>;
  requiredItemIds?: string[];
  minPartySize?: number;
}

/** Upgrade price bounds as a share of the covered retail value (0.33 = 33%). */
export interface AnchorPricing {
  minPriceRate: number;
  maxPriceRate: number;
}

export interface AnchorRedemptionRules {
  /** 0 = Sunday … 6 = Saturday. Empty/undefined = any day. */
  allowedWeekdays?: number[];
  /** Only redeemable during the merchant's configured off-peak windows. */
  offPeakOnly?: boolean;
  /** Redemption visit must include at least one new purchase. */
  requiresNewPurchase?: boolean;
  minNewSpendCents?: number;
}

export type RefundPolicy = "none" | "unused_within_14_days" | "unused_any_time";

export interface AnchorProgram {
  id: string;
  merchantId: string;
  name: string;
  status: AnchorProgramStatus;
  issueMode: AnchorIssueMode;
  unitType: AnchorUnitType;
  unitLabel: string;
  unitLabelPlural: string;
  /** Units the customer keeps: 1 main, 2 pints, 100 (percent) for a bottle, 2 sessions. */
  unitsGranted: number;
  coverage: AnchorCoverage;
  trigger: AnchorTrigger;
  pricing: AnchorPricing;
  validityDays: number;
  redemption: AnchorRedemptionRules;
  transferable: boolean;
  refundPolicy: RefundPolicy;
  /** Customer may put the anchor towards a pricier item and pay the difference. */
  upgradeAllowed: boolean;
  /** Plain-language terms shown on the wallet. */
  terms: string;
  createdAt: Date;
  updatedAt: Date;
}

export type AnchorProgramInput = Omit<AnchorProgram, "id" | "merchantId" | "createdAt" | "updatedAt">;

export type EntitlementStatus = "pending_claim" | "active" | "fully_redeemed" | "expired" | "voided" | "refunded";

/** Terms frozen at issue time. Later program edits never change what a customer bought. */
export interface TermsSnapshot {
  programName: string | null;
  coverageText: string;
  expiresAt: string | null;
  redemption: AnchorRedemptionRules;
  transferable: boolean;
  refundPolicy: RefundPolicy;
  upgradeAllowed: boolean;
  terms: string;
  pricePaidCents: number;
  currency: string;
  issuedAt: string;
}

export interface Entitlement {
  id: string;
  merchantId: string;
  customerId: string | null;
  programId: string | null;
  originVisitId: string | null;
  /** Specific item (e.g. the bottle) or null when coverage is a category. */
  itemId: string | null;
  /** upgrade_offer = paid extra at checkout; stored_purchase = already bought and expensed. */
  issueMode: AnchorIssueMode;
  /** Customer-facing name: "Main", "Macallan 12", "Pint", "60-min Massage". */
  displayName: string;
  unitType: AnchorUnitType;
  unitLabel: string;
  unitLabelPlural: string;
  quantityInitial: number;
  quantityRemaining: number;
  coveredCategory: string | null;
  maxCoveredPriceCents: number | null;
  /** Retail value of one unit (for percent: of 100%). Used for liability and reporting. */
  unitRetailCents: number;
  /** Cost of one unit (for percent: of 100%). */
  unitCostCents: number;
  /** What the customer paid to create this anchor (0 for stored purchases). */
  pricePaidCents: number;
  storageLocation: string | null;
  expiresAt: Date | null;
  transferable: boolean;
  termsSnapshot: TermsSnapshot;
  status: EntitlementStatus;
  claimExpiresAt: Date | null;
  issuedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Optimistic-lock counter; incremented on every ledger change. */
  version: number;
}

export type EntitlementEventType =
  | "issued"
  | "claimed"
  | "redeemed"
  | "level_recorded"
  | "adjusted"
  | "expired"
  | "voided"
  | "refunded"
  | "transferred";

export type ActorType = "user" | "staff" | "customer" | "system" | "api";

export interface EntitlementEvent {
  id: string;
  merchantId: string;
  entitlementId: string;
  type: EntitlementEventType;
  quantityDelta: number;
  quantityAfter: number;
  visitId: string | null;
  actorType: ActorType;
  actorId: string | null;
  note: string | null;
  createdAt: Date;
}

/** Result of a pure ledger operation, applied by the anchors service in a transaction. */
export interface LedgerChange {
  quantityAfter: number;
  statusAfter: EntitlementStatus;
  event: Pick<EntitlementEvent, "type" | "quantityDelta" | "quantityAfter" | "note">;
}
