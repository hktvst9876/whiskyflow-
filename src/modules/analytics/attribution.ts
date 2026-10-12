/**
 * Attributed (NOT causal) revenue metrics for a period (pure). Always shown with the
 * label "attributed, not causal"; the holdout lift in `lift.ts` is the causal answer.
 *
 * Definitions:
 * - Redemption visit: a closed visit with at least one anchor_redemption line.
 * - Stored value redeemed: retail value of the units consumed from anchors.
 * - New cash during redemption visits: regular (new) lines on redemption visits.
 * - New packages sold: anchor upgrade revenue + stored purchases sold (e.g. bottles kept).
 * - Promotional cost: perk cost + discounts + message cost.
 * - Attributed contribution: GP of new cash on redemption visits + package revenue −
 *   cost of redeemed upgrade anchors − promotional cost.
 */

export interface AttributionVisitRow {
  visitId: string;
  customerId: string | null;
  isRedemptionVisit: boolean;
  newCashRevenueCents: number;
  newCashCostCents: number;
  anchorUpgradeRevenueCents: number;
  redemptionCostCents: number;
  redeemedRetailCents: number;
  redemptionCount: number;
  perkCostCents: number;
  discountCents: number;
}

export interface AttributionSummary {
  redemptions: number;
  customersReturning: number;
  storedValueRedeemedCents: number;
  newCashDuringRedemptionsCents: number;
  grossProfitFromNewCashCents: number;
  newPackagesSoldCents: number;
  totalAttributableRevenueCents: number;
  promotionalCostCents: number;
  attributedContributionCents: number;
}

export function summariseAttribution(
  rows: AttributionVisitRow[],
  extra: { storedPurchaseRevenueCents?: number; messageCostCents?: number } = {},
): AttributionSummary {
  const redemptionVisits = rows.filter((r) => r.isRedemptionVisit);
  const customers = new Set(redemptionVisits.map((r) => r.customerId).filter(Boolean));
  const sum = (list: AttributionVisitRow[], f: (r: AttributionVisitRow) => number) => list.reduce((s, r) => s + f(r), 0);

  const newCash = sum(redemptionVisits, (r) => r.newCashRevenueCents);
  const newCashGp = sum(redemptionVisits, (r) => r.newCashRevenueCents - r.newCashCostCents);
  const packages = sum(rows, (r) => r.anchorUpgradeRevenueCents) + (extra.storedPurchaseRevenueCents ?? 0);
  const promo = sum(rows, (r) => r.perkCostCents + r.discountCents) + (extra.messageCostCents ?? 0);
  const redemptionCost = sum(rows, (r) => r.redemptionCostCents);

  return {
    redemptions: sum(rows, (r) => r.redemptionCount),
    customersReturning: customers.size,
    storedValueRedeemedCents: sum(rows, (r) => r.redeemedRetailCents),
    newCashDuringRedemptionsCents: newCash,
    grossProfitFromNewCashCents: newCashGp,
    newPackagesSoldCents: packages,
    totalAttributableRevenueCents: newCash + packages,
    promotionalCostCents: promo,
    attributedContributionCents: newCashGp + sum(rows, (r) => r.anchorUpgradeRevenueCents) - redemptionCost - promo,
  };
}
