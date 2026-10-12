import "server-only";
import { normaliseCode } from "@/core/ids";
import { normalisePhone } from "@/core/phone";
import { inTransaction, type Db } from "@/server/db";
import type { CanonicalOrder } from "@/integrations/pos/canonical";
import { matchItem } from "@/modules/catalog/repo";
import { findCustomerByPhone, findCustomerByRedeemCode, insertCustomer } from "@/modules/customers/repo";
import { findVisitByExternalRef, insertLine, insertVisit, updateVisit, voidRegularLines } from "@/modules/visits/repo";
import type { VisitStatus } from "@/modules/visits/types";
import { merchantFor, type FlowContext } from "./context";
import { evaluateCheckoutOffer, getCheckoutOffer, type CheckoutOfferView } from "./checkout-offer";
import { closeVisit } from "./close-visit";

/**
 * POS ingestion (alternative to POS-lite for step 2): a canonical order is upserted as a
 * visit idempotently by `externalRef`. Re-sending an open order replaces its regular
 * lines; anchor lines added through our staff screens are never touched. Optionally the
 * checkout offer is evaluated and returned so the POS can show it to staff.
 */

export interface PosIngestResult {
  visitId: string;
  status: VisitStatus;
  created: boolean;
  offer: {
    outcome: CheckoutOfferView["decision"]["outcome"];
    exposureId: string | null;
    staffText: string | null;
    script: string | null;
    priceCents: number | null;
    label: string | null;
    reason: string;
  } | null;
  closeError: string | null;
}

function offerSummary(view: CheckoutOfferView | null): PosIngestResult["offer"] {
  if (!view) return null;
  return {
    outcome: view.decision.outcome,
    exposureId: view.exposure?.id ?? null,
    staffText: view.decision.outcome === "offered" ? (view.candidate?.pitch.staff ?? null) : null,
    script: view.decision.outcome === "offered" ? (view.candidate?.pitch.script ?? null) : null,
    priceCents: view.decision.outcome === "offered" ? (view.candidate?.priceCents ?? null) : null,
    label: view.decision.outcome === "offered" ? (view.candidate?.pitch.label ?? null) : null,
    reason: view.reason,
  };
}

export async function ingestPosOrder(db: Db, ctx: FlowContext, order: CanonicalOrder): Promise<PosIngestResult> {
  const merchant = await merchantFor(db, ctx);
  const { visitId, status, created } = await inTransaction(db, async (tx) => {
    let visit = await findVisitByExternalRef(tx, ctx.merchantId, order.externalRef);
    const created = !visit;
    if (visit && visit.status !== "open") return { visitId: visit.id, status: visit.status, created: false };
    if (!visit) {
      visit = await insertVisit(tx, {
        merchantId: ctx.merchantId,
        partySize: order.partySize,
        source: "pos",
        externalRef: order.externalRef,
        label: order.label ?? null,
        openedAt: order.openedAt ?? ctx.now,
      });
    } else {
      await voidRegularLines(tx, visit.id, ctx.now);
      await updateVisit(tx, visit.id, { partySize: order.partySize, label: order.label ?? visit.label });
    }
    if (order.customer && !visit.customerId) {
      let customerId: string | null = null;
      if (order.customer.redeemCode) customerId = (await findCustomerByRedeemCode(tx, ctx.merchantId, normaliseCode(order.customer.redeemCode)))?.id ?? null;
      if (!customerId && order.customer.phone) {
        const phone = normalisePhone(order.customer.phone, merchant.merchant.country);
        if (phone) {
          customerId =
            (await findCustomerByPhone(tx, ctx.merchantId, phone))?.id ??
            (await insertCustomer(tx, { merchantId: ctx.merchantId, phoneE164: phone, at: ctx.now })).id;
        }
      }
      if (customerId) await updateVisit(tx, visit.id, { customerId });
    }
    for (const line of order.lines) {
      const item = await matchItem(tx, ctx.merchantId, { sku: line.sku ?? null, name: line.name });
      await insertLine(tx, {
        merchantId: ctx.merchantId,
        visitId: visit.id,
        itemId: item?.id ?? null,
        name: line.name,
        category: line.category ?? item?.category ?? "other",
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        unitCostCents: line.unitCostCents ?? item?.costCents ?? 0,
        lineType: "regular",
        at: ctx.now,
      });
    }
    return { visitId: visit.id, status: visit.status, created };
  });

  if (status !== "open") return { visitId, status, created, offer: offerSummary(await getCheckoutOffer(db, ctx, visitId)), closeError: null };

  let offer: PosIngestResult["offer"] = null;
  if (order.evaluateOffer && order.status === "open") offer = offerSummary(await evaluateCheckoutOffer(db, ctx, visitId));
  else offer = offerSummary(await getCheckoutOffer(db, ctx, visitId));

  let finalStatus: VisitStatus = "open";
  let closeError: string | null = null;
  if (order.status === "closed") {
    try {
      await closeVisit(db, { ...ctx, now: order.closedAt ?? ctx.now }, visitId);
      finalStatus = "closed";
    } catch (error) {
      closeError = error instanceof Error ? error.message : String(error);
    }
  } else if (order.status === "voided") {
    await updateVisit(db, visitId, { status: "voided", closedAt: ctx.now });
    finalStatus = "voided";
  }
  return { visitId, status: finalStatus, created, offer, closeError };
}
