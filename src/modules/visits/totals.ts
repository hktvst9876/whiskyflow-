/** Basket maths (pure). Voided lines are ignored everywhere. */
import type { LineType, VisitLine, VisitTotals } from "./types";

export type TotalsLine = Pick<VisitLine, "lineType" | "quantity" | "unitPriceCents" | "unitCostCents" | "voidedAt">;

export function computeTotals(lines: readonly TotalsLine[]): VisitTotals {
  const t: VisitTotals = {
    revenueCents: 0,
    costCents: 0,
    gpCents: 0,
    newCashRevenueCents: 0,
    newCashCostCents: 0,
    newCashGpCents: 0,
    anchorUpgradeRevenueCents: 0,
    redemptionCostCents: 0,
    perkCostCents: 0,
    discountCents: 0,
    isRedemptionVisit: false,
    itemCount: 0,
  };
  for (const line of lines) {
    if (line.voidedAt) continue;
    const revenue = line.unitPriceCents * line.quantity;
    const cost = line.unitCostCents * line.quantity;
    t.revenueCents += revenue;
    t.costCents += cost;
    switch (line.lineType as LineType) {
      case "regular":
        t.newCashRevenueCents += revenue;
        t.newCashCostCents += cost;
        t.itemCount += line.quantity;
        break;
      case "anchor_upgrade":
        t.anchorUpgradeRevenueCents += revenue;
        break;
      case "anchor_redemption":
        t.redemptionCostCents += cost;
        t.isRedemptionVisit = true;
        break;
      case "perk":
        t.perkCostCents += cost;
        break;
      case "discount":
        t.discountCents += -revenue;
        break;
    }
  }
  t.gpCents = t.revenueCents - t.costCents;
  t.newCashGpCents = t.newCashRevenueCents - t.newCashCostCents;
  return t;
}

/** Did this visit use any promotion (perk/discount)? Feeds price-sensitivity. */
export function usedPromotion(lines: readonly TotalsLine[]): boolean {
  return lines.some((l) => !l.voidedAt && (l.lineType === "perk" || l.lineType === "discount"));
}
