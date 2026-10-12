import "server-only";
import { ValidationError } from "@/core/errors";
import { formatCode, normaliseCode } from "@/core/ids";
import { maskPhone, normalisePhone } from "@/core/phone";
import { inTransaction, type Db } from "@/server/db";
import { entitlementLabel } from "@/modules/anchors/labels";
import { applyAdjust, applyVoid, checkRedemptionRules, isExpired } from "@/modules/anchors/ledger";
import { getEntitlement, listEntitlements, listEntitlementsForCustomer, type EntitlementRecord } from "@/modules/anchors/repo";
import { applyLedgerChange, claimTokenFor } from "@/modules/anchors/service";
import { transparencyLines } from "@/modules/anchors/terms";
import { findCustomerByPhone, findCustomerByRedeemCode, getCustomer, insertCustomer, type CustomerWithPromo } from "@/modules/customers/repo";
import type { MerchantContext } from "@/modules/merchants/repo";
import { cancelScheduledForEntitlement } from "@/modules/messaging/repo";
import { offerKind } from "@/modules/offers/kinds";
import { getDefinition, getExposure, updateExposure, usableExposuresForCustomer } from "@/modules/offers/repo";
import type { OfferExposure } from "@/modules/offers/types";
import { getItem, listItems } from "@/modules/catalog/repo";
import { getLine, getVisit, insertLine, insertVisit, listLines, listVisits, updateVisit, voidLineRow } from "@/modules/visits/repo";
import { computeTotals } from "@/modules/visits/totals";
import type { Visit, VisitLine, VisitTotals } from "@/modules/visits/types";
import { assertSameMerchant, claimUrl, merchantFor, type FlowContext } from "./context";
import { getCheckoutOffer, type CheckoutOfferView } from "./checkout-offer";

/**
 * Staff POS-lite: open a bill, add items, identify the customer, remove lines. Removing a
 * paid upgrade voids its (unused) anchor; removing a redemption puts the units back — so
 * the ledger and the bill can never disagree.
 */

export async function openVisit(
  db: Db,
  ctx: FlowContext,
  input: { partySize: number; label?: string | null; customerId?: string | null },
): Promise<Visit> {
  if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 50) throw new ValidationError("Party size must be 1-50.");
  if (input.customerId) await getCustomer(db, ctx.merchantId, input.customerId);
  return insertVisit(db, {
    merchantId: ctx.merchantId,
    partySize: input.partySize,
    label: input.label?.trim() || null,
    customerId: input.customerId ?? null,
    openedByUserId: ctx.actor.type === "user" || ctx.actor.type === "staff" ? ctx.actor.id : null,
    openedAt: ctx.now,
  });
}

async function openVisitFor(db: Db, ctx: FlowContext, visitId: string, lock = false): Promise<Visit> {
  const visit = await getVisit(db, ctx.merchantId, visitId, { forUpdate: lock });
  assertSameMerchant(visit, ctx);
  if (visit.status !== "open") throw new ValidationError("This bill is already closed.");
  return visit;
}

export async function addItem(db: Db, ctx: FlowContext, visitId: string, itemId: string, quantity = 1): Promise<VisitLine> {
  await openVisitFor(db, ctx, visitId);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new ValidationError("Quantity must be 1-99.");
  const item = await getItem(db, ctx.merchantId, itemId);
  if (!item.active) throw new ValidationError(`${item.name} is not on the menu right now.`);
  return insertLine(db, {
    merchantId: ctx.merchantId,
    visitId,
    itemId: item.id,
    name: item.name,
    category: item.category,
    quantity,
    unitPriceCents: item.priceCents,
    unitCostCents: item.costCents,
    lineType: "regular",
    at: ctx.now,
  });
}

export async function setPartySize(db: Db, ctx: FlowContext, visitId: string, partySize: number) {
  await openVisitFor(db, ctx, visitId);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) throw new ValidationError("Party size must be 1-50.");
  await updateVisit(db, visitId, { partySize });
}

/** Remove a line from an open bill, keeping the anchor ledger consistent. */
export async function voidLine(db: Db, ctx: FlowContext, visitId: string, lineId: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    await openVisitFor(tx, ctx, visitId, true);
    const line = await getLine(tx, ctx.merchantId, lineId);
    if (line.visitId !== visitId || line.voidedAt) throw new ValidationError("That line is not on this bill.");
    if (line.lineType === "anchor_upgrade" && line.entitlementId) {
      const e = await getEntitlement(tx, ctx.merchantId, line.entitlementId, { forUpdate: true });
      if (e.quantityRemaining !== e.quantityInitial || !["pending_claim", "active"].includes(e.status)) {
        throw new ValidationError("This anchor has already been used, so the upgrade can't be removed.");
      }
      await applyLedgerChange(tx, e, applyVoid(e, "Upgrade removed from the bill"), { visitId, actor: ctx.actor, at: ctx.now });
      await cancelScheduledForEntitlement(tx, e.id, "Anchor voided", ctx.now);
      if (line.offerExposureId) await updateExposure(tx, line.offerExposureId, { status: "declined", respondedAt: ctx.now });
    } else if (line.lineType === "anchor_redemption" && line.entitlementId) {
      const e = await getEntitlement(tx, ctx.merchantId, line.entitlementId, { forUpdate: true });
      await applyLedgerChange(tx, e, applyAdjust(e, line.quantity, "Redemption reversed (removed from the bill)"), {
        visitId,
        actor: ctx.actor,
        at: ctx.now,
        auditAction: "entitlement.redemption_reversed",
      });
    } else if ((line.lineType === "perk" || line.lineType === "discount") && line.offerExposureId) {
      await updateExposure(tx, line.offerExposureId, { status: "shown", respondedAt: null, visitId: null });
    }
    await voidLineRow(tx, line.id, ctx.now);
  });
}

// ── Customer identification at the till ───────────────────────────────────

/** Find a customer by wallet code ("ABCD-2345") or phone number. */
export async function findCustomer(db: Db, ctx: FlowContext, query: string): Promise<CustomerWithPromo | null> {
  const q = query.trim();
  if (!q) return null;
  const code = normaliseCode(q);
  if (/^[2-9A-HJ-NP-Z]{8}$/.test(code)) {
    const byCode = await findCustomerByRedeemCode(db, ctx.merchantId, code);
    if (byCode) return byCode;
  }
  const merchant = await merchantFor(db, ctx);
  const phone = normalisePhone(q, merchant.merchant.country);
  return phone ? findCustomerByPhone(db, ctx.merchantId, phone) : null;
}

/** Attach a known customer to the bill (scan of their wallet QR or phone lookup). */
export async function attachCustomer(db: Db, ctx: FlowContext, visitId: string, customerId: string): Promise<void> {
  const visit = await openVisitFor(db, ctx, visitId);
  const customer = await getCustomer(db, ctx.merchantId, customerId);
  if (customer.status !== "active") throw new ValidationError("This customer record has been anonymised.");
  if (visit.customerId && visit.customerId !== customerId) throw new ValidationError("Another customer is already on this bill.");
  await updateVisit(db, visitId, { customerId });
}

/** New customer at the till: a profile by phone (messaging still needs their consent). */
export async function createCustomerAtTill(db: Db, ctx: FlowContext, input: { phone: string; name?: string | null }): Promise<CustomerWithPromo> {
  const merchant = await merchantFor(db, ctx);
  const phone = normalisePhone(input.phone, merchant.merchant.country);
  if (!phone) throw new ValidationError("Enter a valid mobile number.", { phone: "Enter a valid mobile number." });
  const existing = await findCustomerByPhone(db, ctx.merchantId, phone);
  if (existing) return existing;
  return insertCustomer(db, { merchantId: ctx.merchantId, phoneE164: phone, displayName: input.name?.trim() || null, at: ctx.now });
}

// ── Read models for the staff screens ──────────────────────────────────────

export interface AnchorCard {
  id: string;
  label: string;
  displayName: string;
  unitType: EntitlementRecord["unitType"];
  quantityRemaining: number;
  quantityInitial: number;
  status: EntitlementRecord["status"];
  expiresAt: Date | null;
  storageLocation: string | null;
  coveredCategory: string | null;
  maxCoveredPriceCents: number | null;
  upgradeAllowed: boolean;
  transferable: boolean;
  /** Can staff redeem it right now? */
  redeemable: boolean;
  blockedReason: string;
  terms: { label: string; value: string }[];
}

export function anchorCard(e: EntitlementRecord, merchant: MerchantContext, now: Date): AnchorCard {
  let redeemable = e.status === "active" && !isExpired(e, now);
  let blockedReason = e.status === "pending_claim" ? "Not claimed yet" : e.status !== "active" ? e.status.replace("_", " ") : isExpired(e, now) ? "Expired" : "";
  if (redeemable) {
    const rules = checkRedemptionRules(e.termsSnapshot.redemption, now, merchant.merchant.timezone, merchant.settings.business.offPeak);
    if (!rules.ok) {
      redeemable = false;
      blockedReason = rules.reason;
    }
  }
  return {
    id: e.id,
    label: entitlementLabel(e),
    displayName: e.displayName,
    unitType: e.unitType,
    quantityRemaining: e.quantityRemaining,
    quantityInitial: e.quantityInitial,
    status: e.status,
    expiresAt: e.expiresAt,
    storageLocation: e.storageLocation,
    coveredCategory: e.coveredCategory,
    maxCoveredPriceCents: e.maxCoveredPriceCents,
    upgradeAllowed: e.termsSnapshot.upgradeAllowed,
    transferable: e.transferable,
    redeemable,
    blockedReason,
    terms: transparencyLines(e.termsSnapshot, { locale: merchant.merchant.locale, timeZone: merchant.merchant.timezone }),
  };
}

export interface PromoCard {
  exposureId: string;
  name: string;
  line: string;
  offerType: OfferExposure["offerType"];
  expiresAt: Date | null;
}

export interface VisitView {
  visit: Visit;
  lines: VisitLine[];
  totals: VisitTotals;
  customer: {
    id: string;
    name: string | null;
    phoneMasked: string;
    redeemCode: string;
    segment: CustomerWithPromo["segment"];
    returnBand: CustomerWithPromo["returnBand"];
    score: number | null;
    visitCount: number;
  } | null;
  /** The customer's open anchors (to redeem tonight). */
  anchors: AnchorCard[];
  /** Anchors created on THIS bill that still wait for the QR scan. */
  pendingClaims: { entitlementId: string; label: string; claimUrl: string; claimExpiresAt: Date | null }[];
  /** WhatsApp promotions the customer can use tonight. */
  promos: PromoCard[];
  checkout: CheckoutOfferView | null;
}

export async function visitView(db: Db, ctx: FlowContext, visitId: string): Promise<VisitView> {
  const merchant = await merchantFor(db, ctx);
  const visit = await getVisit(db, ctx.merchantId, visitId);
  assertSameMerchant(visit, ctx);
  const lines = await listLines(db, visitId);
  let customer: VisitView["customer"] = null;
  let anchors: AnchorCard[] = [];
  let promos: PromoCard[] = [];
  if (visit.customerId) {
    const c = await getCustomer(db, ctx.merchantId, visit.customerId);
    customer = {
      id: c.id,
      name: c.displayName,
      phoneMasked: maskPhone(c.phoneE164),
      redeemCode: formatCode(c.redeemCode),
      segment: c.segment,
      returnBand: c.returnBand,
      score: c.returnProbability === null ? null : Math.round(c.returnProbability * 100),
      visitCount: c.visitCount,
    };
    anchors = (await listEntitlementsForCustomer(db, c.id, ["active", "pending_claim"])).map((e) => anchorCard(e, merchant, ctx.now));
    const exposures = await usableExposuresForCustomer(db, c.id, ctx.now);
    promos = exposures.map((x) => ({
      exposureId: x.id,
      name: String(x.payload.name ?? x.offerType),
      line: String(x.payload.line ?? ""),
      offerType: x.offerType,
      expiresAt: x.expiresAt,
    }));
  }
  const pendingClaims = (await listEntitlements(db, ctx.merchantId, { originVisitId: visitId, statuses: ["pending_claim"] })).map((e) => ({
    entitlementId: e.id,
    label: entitlementLabel(e),
    claimUrl: claimUrl(claimTokenFor(e.id)),
    claimExpiresAt: e.claimExpiresAt,
  }));
  return {
    visit,
    lines,
    totals: computeTotals(lines),
    customer,
    anchors,
    pendingClaims,
    promos,
    checkout: await getCheckoutOffer(db, ctx, visitId),
  };
}

export async function listOpenVisits(db: Db, ctx: FlowContext) {
  const visits = await listVisits(db, ctx.merchantId, { status: "open", limit: 50 });
  const result = [];
  for (const v of visits) {
    const totals = computeTotals(await listLines(db, v.id));
    const c = v.customerId ? await getCustomer(db, ctx.merchantId, v.customerId) : null;
    result.push({ visit: v, totals, customerName: c?.displayName ?? (c ? maskPhone(c.phoneE164) : null) });
  }
  return result;
}

/** Apply a WhatsApp promotion the customer shows at the till (perk or bundle lines). */
export async function applyCustomerPromo(db: Db, ctx: FlowContext, visitId: string, exposureId: string): Promise<VisitLine[]> {
  return inTransaction(db, async (tx) => {
    const visit = await openVisitFor(tx, ctx, visitId, true);
    const exposure = await getExposure(tx, ctx.merchantId, exposureId, { forUpdate: true });
    if (exposure.customerId !== visit.customerId) throw new ValidationError("This promotion belongs to another customer.");
    if (exposure.status !== "shown") throw new ValidationError(`This promotion was already ${exposure.status}.`);
    if (exposure.expiresAt && exposure.expiresAt.getTime() < ctx.now.getTime()) throw new ValidationError("This promotion has expired.");
    if (!exposure.offerDefinitionId) throw new ValidationError("This promotion cannot be applied to a bill.");
    const lines = await listLines(tx, visitId);
    if (lines.some((l) => l.lineType === "perk" || l.lineType === "discount")) throw new ValidationError("This bill already has a promotion (no stacking).");
    const def = await getDefinition(tx, ctx.merchantId, exposure.offerDefinitionId);
    const catalog = await listItems(tx, ctx.merchantId);
    let offerLines;
    try {
      offerLines = offerKind(def.offerType).applyToBill(def.config, catalog, lines);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "This promotion cannot be applied.");
    }
    const inserted: VisitLine[] = [];
    for (const l of offerLines) {
      inserted.push(await insertLine(tx, { merchantId: ctx.merchantId, visitId, ...l, offerExposureId: exposure.id, at: ctx.now }));
    }
    const cost = offerLines.filter((l) => l.lineType === "perk").reduce((s, l) => s + l.unitCostCents * l.quantity, 0);
    const discount = offerLines.filter((l) => l.lineType === "discount").reduce((s, l) => s - l.unitPriceCents * l.quantity, 0);
    await updateExposure(tx, exposure.id, { status: "redeemed", respondedAt: ctx.now, visitId, promoCostCents: cost + discount });
    return inserted;
  });
}
