import "server-only";
import { ValidationError } from "@/core/errors";
import { formatMoney } from "@/core/money";
import { inTransaction, type Db } from "@/server/db";
import { getEntitlement } from "@/modules/anchors/repo";
import { exposuresForVisit, updateExposure } from "@/modules/offers/repo";
import { getVisit, listLines, updateVisit } from "@/modules/visits/repo";
import { computeTotals } from "@/modules/visits/totals";
import type { VisitTotals } from "@/modules/visits/types";
import { assertSameMerchant, merchantFor, type FlowContext } from "./context";
import { refreshCustomer } from "./scoring";

/**
 * MVP steps 17-18: close the bill, compute what the visit earned (new cash vs value
 * redeemed), refresh the customer's aggregates and score. Whether a NEW anchor is
 * created on this visit is the checkout offer (`evaluateCheckoutOffer`), which staff see
 * on every bill — including redemption visits — before payment; the guardrails
 * (max active anchors, cooldowns) decide if another one makes sense.
 */

export interface VisitSummary {
  totals: VisitTotals;
  /** One-line explanation for staff: "Redemption visit: $46 new cash (GP $31) on top of 1 main." */
  headline: string;
}

export async function closeVisit(db: Db, ctx: FlowContext, visitId: string): Promise<VisitSummary> {
  const merchant = await merchantFor(db, ctx);
  const money = (c: number) => formatMoney(c, { currency: merchant.merchant.currency, locale: merchant.merchant.locale, compact: true });
  const { totals, customerId } = await inTransaction(db, async (tx) => {
    const visit = await getVisit(tx, ctx.merchantId, visitId, { forUpdate: true });
    assertSameMerchant(visit, ctx);
    if (visit.status !== "open") throw new ValidationError("This bill is already closed.");
    const lines = await listLines(tx, visitId);
    if (lines.length === 0) throw new ValidationError("Add something to the bill before closing it.");
    const totals = computeTotals(lines);

    // Anchors that require a new purchase are only valid with new cash on the same bill.
    const redeemedIds = [...new Set(lines.filter((l) => l.lineType === "anchor_redemption" && l.entitlementId).map((l) => l.entitlementId!))];
    for (const id of redeemedIds) {
      const e = await getEntitlement(tx, ctx.merchantId, id);
      const r = e.termsSnapshot.redemption;
      if (r.requiresNewPurchase && totals.newCashRevenueCents <= 0) {
        throw new ValidationError(`${e.displayName} is redeemed with a new purchase — add something to the bill or remove the redemption.`);
      }
      if (r.minNewSpendCents && totals.newCashRevenueCents < r.minNewSpendCents) {
        throw new ValidationError(`${e.displayName} needs at least ${money(r.minNewSpendCents)} of new purchases on the bill.`);
      }
    }
    // A checkout offer nobody answered expires with the bill.
    for (const x of await exposuresForVisit(tx, visitId)) {
      if (x.status === "shown" && x.channel === "pos") await updateExposure(tx, x.id, { status: "expired", respondedAt: ctx.now });
    }
    await updateVisit(tx, visitId, { status: "closed", closedAt: ctx.now });
    return { totals, customerId: visit.customerId };
  });

  if (customerId) await refreshCustomer(db, merchant, customerId, ctx.now);

  let headline: string;
  if (totals.isRedemptionVisit) {
    headline = `Redemption visit: ${money(totals.newCashRevenueCents)} new cash (GP ${money(totals.newCashGpCents)}) on top of what they already owned.`;
  } else if (totals.anchorUpgradeRevenueCents > 0) {
    headline = `New Return Anchor sold: ${money(totals.anchorUpgradeRevenueCents)} today, and a reason to come back.`;
  } else {
    headline = `Bill closed: ${money(totals.revenueCents)} (GP ${money(totals.gpCents)}).`;
  }
  return { totals, headline };
}
