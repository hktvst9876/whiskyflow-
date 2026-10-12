/** Visit (bill/ticket) domain types for the POS-lite and POS ingestion. */

export type VisitStatus = "open" | "closed" | "voided";
export type VisitSource = "staff" | "pos";

/**
 * regular          normal sale (new cash)
 * anchor_upgrade   the +$X paid today to create a Return Anchor
 * anchor_redemption price 0; cost = cost of what was consumed from an anchor
 * perk             complimentary item (price 0, cost > 0)
 * discount         negative price line
 */
export type LineType = "regular" | "anchor_upgrade" | "anchor_redemption" | "perk" | "discount";

export interface Visit {
  id: string;
  merchantId: string;
  locationId: string | null;
  customerId: string | null;
  partySize: number;
  status: VisitStatus;
  source: VisitSource;
  /** POS bill ID when ingested from a POS. */
  externalRef: string | null;
  /** Free label such as a table name ("T12") or "Walk-in". */
  label: string | null;
  openedByUserId: string | null;
  openedAt: Date;
  closedAt: Date | null;
}

export interface VisitLine {
  id: string;
  merchantId: string;
  visitId: string;
  itemId: string | null;
  name: string;
  category: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  lineType: LineType;
  entitlementId: string | null;
  offerExposureId: string | null;
  createdAt: Date;
  voidedAt: Date | null;
}

export interface VisitTotals {
  /** All money the customer pays on this visit (regular + upgrades − discounts). */
  revenueCents: number;
  /** All cost of goods on this visit (including redeemed anchors and perks). */
  costCents: number;
  gpCents: number;
  /** Regular lines only — "new cash". */
  newCashRevenueCents: number;
  newCashCostCents: number;
  newCashGpCents: number;
  anchorUpgradeRevenueCents: number;
  redemptionCostCents: number;
  perkCostCents: number;
  discountCents: number;
  isRedemptionVisit: boolean;
  itemCount: number;
}
