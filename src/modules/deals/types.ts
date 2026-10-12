/** Dynamic deal engine types (pure). */

import type { AnchorProgram, AnchorUnitType } from "../anchors/types";
import type { CatalogItem } from "../catalog/types";
import type { MerchantSettings } from "../merchants/settings";
import type { Segment } from "../scoring/types";

export interface BasketLine {
  itemId: string | null;
  category: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
}

export interface Basket {
  /** Regular (new cash) lines only. */
  lines: BasketLine[];
  partySize: number;
}

/** What the engine knows about the customer at the till (null = anonymous). */
export interface DealCustomer {
  /** Return probability WITHOUT any anchor (Return Score with entitlements removed). */
  p0: number;
  segment: Segment;
  visitCount: number;
  avgVisitGpCents: number | null;
  avgVisitSpendCents: number | null;
}

/** Merchant-wide averages used when the customer has too little history. */
export interface MerchantBaseline {
  avgVisitGpCents: number;
  avgVisitSpendCents: number;
}

export interface DealInput {
  basket: Basket;
  catalog: CatalogItem[];
  programs: AnchorProgram[];
  customer: DealCustomer | null;
  baseline: MerchantBaseline;
  settings: Pick<MerchantSettings, "dealEngine" | "guardrails">;
  /** Holdout-measured lift in return probability, when trustworthy. Replaces the prior. */
  measuredUplift?: number | null;
  /** Cost of any perk bundled with the offer. */
  perkCostCents?: number;
}

export interface DealPitch {
  /** Customer-facing entitlement label, e.g. "1 Main Waiting". */
  label: string;
  /** What staff see: "Offer +$9 → 1 Main Waiting". */
  staff: string;
  /** What staff can say to the customer. */
  script: string;
  /** Plain-language coverage, e.g. "any main up to $24". */
  coverage: string;
}

/** One evaluated program at its best price point (or the reasons it failed). */
export interface DealCandidate {
  programId: string;
  programName: string;
  unitType: AnchorUnitType;
  unitLabel: string;
  unitLabelPlural: string;
  displayName: string;
  units: number;
  coveredCategory: string | null;
  coveredItemIds: string[] | null;
  maxCoveredPriceCents: number | null;
  /** Representative catalog item for item coverage (bottle, specific dish). */
  itemId: string | null;
  unitRetailCents: number;
  unitCostCents: number;
  coveredRetailCents: number;
  coveredCostCents: number;
  /** U — what the customer pays today for the anchor. */
  priceCents: number;
  priceRate: number;
  /** Implied discount depth: 1 − U / covered retail. */
  depth: number;
  p0: number;
  p1: number;
  uplift: number;
  upliftSource: "prior" | "measured";
  /** G — expected gross profit of a normal next visit. */
  baselineGpCents: number;
  /** Gnew — expected gross profit of the anchored next visit. */
  anchoredGpCents: number;
  /** ΔE = U − C + p1·Gnew − p0·G − perkCost. */
  deltaECents: number;
  pAccept: number;
  /** pAccept × ΔE — the ranking value. */
  expectedValueCents: number;
  todayMarginRate: number;
  expectedNextVisitSpendCents: number;
  eligible: boolean;
  /** Why the program or every price point was rejected (empty when eligible). */
  reasons: string[];
  pricePointsTried: number;
  pitch: DealPitch;
}

export interface DealResult {
  best: DealCandidate | null;
  candidates: DealCandidate[];
}
