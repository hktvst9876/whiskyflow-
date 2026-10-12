import "server-only";
import { ValidationError } from "@/core/errors";
import { formatMoney } from "@/core/money";
import { inTransaction, type Db } from "@/server/db";
import { entitlementLabel, quantityText } from "@/modules/anchors/labels";
import { applyLevel, applyRedeem, checkRedemptionRules, redemptionCostCents } from "@/modules/anchors/ledger";
import { getEntitlement, type EntitlementRecord } from "@/modules/anchors/repo";
import { applyLedgerChange } from "@/modules/anchors/service";
import { getItem, listItems } from "@/modules/catalog/repo";
import { getCustomer } from "@/modules/customers/repo";
import { cancelScheduledForEntitlement } from "@/modules/messaging/repo";
import { offerKind } from "@/modules/offers/kinds";
import { getDefinition, insertExposure, listDefinitions } from "@/modules/offers/repo";
import { recommendUpsell, type UpsellBundle, type UpsellRecommendation } from "@/modules/upsell";
import { categoryAffinity, getVisit, insertLine, listLines, updateVisit } from "@/modules/visits/repo";
import type { VisitLine } from "@/modules/visits/types";
import { verticalPreset } from "@/verticals";
import { assertSameMerchant, merchantFor, type FlowContext } from "./context";
import { scheduleMessage, sendMessageNow } from "./messages";

/**
 * MVP steps 12-16: the customer is back, staff scan their wallet QR, the anchor is used
 * (units, or a new bottle level), and staff get the add-ons most likely to sell —
 * "existing entitlement creates the visit; new spending creates the profit".
 */

export interface RedeemInput {
  visitId: string;
  entitlementId: string;
  /** Units to use (items/sessions). */
  quantity?: number;
  /** The dish/service chosen for a category anchor (enables premium upgrades). */
  itemId?: string | null;
}

export interface RedeemResult {
  entitlement: EntitlementRecord;
  lines: VisitLine[];
  label: string;
}

async function prepare(tx: Db, ctx: FlowContext, visitId: string, entitlementId: string) {
  const merchant = await merchantFor(tx, ctx);
  const visit = await getVisit(tx, ctx.merchantId, visitId, { forUpdate: true });
  assertSameMerchant(visit, ctx);
  if (visit.status !== "open") throw new ValidationError("This bill is already closed.");
  const e = await getEntitlement(tx, ctx.merchantId, entitlementId, { forUpdate: true });
  if (!e.customerId) throw new ValidationError("This anchor has not been claimed yet. Claim it first.");
  if (visit.customerId && visit.customerId !== e.customerId && !e.transferable) {
    throw new ValidationError("This anchor belongs to another customer and is not transferable.");
  }
  if (!visit.customerId) await updateVisit(tx, visit.id, { customerId: e.customerId });
  const rules = checkRedemptionRules(e.termsSnapshot.redemption, ctx.now, merchant.merchant.timezone, merchant.settings.business.offPeak);
  if (!rules.ok) throw new ValidationError(rules.reason);
  return { merchant, visit, e };
}

async function sendReceipt(db: Db, ctx: FlowContext, e: EntitlementRecord, used: string) {
  if (!e.customerId) return;
  const merchant = await merchantFor(db, ctx);
  const customer = await getCustomer(db, ctx.merchantId, e.customerId);
  const message = await scheduleMessage(db, {
    merchant,
    customer,
    templateKey: "redemption_receipt",
    variables: { used, remaining: e.quantityRemaining > 0 ? entitlementLabel(e) : "nothing left — thanks for coming back!" },
    scheduledFor: ctx.now,
    dedupeKey: `receipt:${e.id}:${e.version}`,
    entitlementId: null,
    at: ctx.now,
  });
  if (message) await sendMessageNow(db, message.id, ctx.now);
}

/** Use units from an item/session anchor. */
export async function redeemEntitlement(db: Db, ctx: FlowContext, input: RedeemInput): Promise<RedeemResult> {
  const quantity = input.quantity ?? 1;
  const result = await inTransaction(db, async (tx) => {
    const { merchant, visit, e } = await prepare(tx, ctx, input.visitId, input.entitlementId);
    const change = applyRedeem(e, quantity, ctx.now);
    const perVisit = e.termsSnapshot.redemption.maxUnitsPerVisit;
    if (perVisit) {
      const already = (await listLines(tx, visit.id)).filter((l) => l.lineType === "anchor_redemption" && l.entitlementId === e.id).reduce((s, l) => s + l.quantity, 0);
      if (already + quantity > perVisit) throw new ValidationError(`Up to ${perVisit} per visit on this anchor.`);
    }
    const lines: VisitLine[] = [];
    const item = input.itemId ? await getItem(tx, ctx.merchantId, input.itemId) : null;
    if (item && e.coveredCategory && item.category !== e.coveredCategory && e.itemId !== item.id) {
      throw new ValidationError(`This anchor covers ${e.coveredCategory.replace(/_/g, " ")}, not ${item.name}.`);
    }
    // Premium upgrade: the anchor covers up to its cap; the customer pays the difference.
    const cap = e.maxCoveredPriceCents ?? (item && e.itemId && item.id !== e.itemId ? e.unitRetailCents : null);
    if (item && cap !== null && item.priceCents > cap) {
      if (!e.termsSnapshot.upgradeAllowed) {
        throw new ValidationError(`This anchor covers dishes up to ${formatMoney(cap, { currency: merchant.merchant.currency, compact: true })}.`);
      }
      lines.push(
        await insertLine(tx, {
          merchantId: ctx.merchantId,
          visitId: visit.id,
          itemId: item.id,
          name: `Upgrade to ${item.name} (difference)`,
          category: item.category,
          quantity,
          unitPriceCents: item.priceCents - cap,
          unitCostCents: Math.max(0, item.costCents - e.unitCostCents),
          lineType: "regular",
          at: ctx.now,
        }),
      );
    }
    const updated = await applyLedgerChange(tx, e, change, { visitId: visit.id, actor: ctx.actor, at: ctx.now });
    lines.unshift(
      await insertLine(tx, {
        merchantId: ctx.merchantId,
        visitId: visit.id,
        itemId: item?.id ?? e.itemId,
        name: `${item?.name ?? e.displayName} (from your anchor)`,
        category: item?.category ?? e.coveredCategory ?? "anchor",
        quantity,
        unitPriceCents: 0,
        unitCostCents: redemptionCostCents(e, 1),
        lineType: "anchor_redemption",
        entitlementId: e.id,
        at: ctx.now,
      }),
    );
    if (updated.status !== "active") await cancelScheduledForEntitlement(tx, e.id, "Anchor used up", ctx.now);
    return { entitlement: updated, lines, label: entitlementLabel(updated) };
  });
  await sendReceipt(db, ctx, result.entitlement, quantityText(result.entitlement.unitType, quantity, result.entitlement.unitLabel, result.entitlement.unitLabelPlural));
  return result;
}

/** Record the new level of a kept bottle (levels only go down). */
export async function recordBottleLevel(db: Db, ctx: FlowContext, input: { visitId: string; entitlementId: string; percent: number }): Promise<RedeemResult> {
  const result = await inTransaction(db, async (tx) => {
    const { visit, e } = await prepare(tx, ctx, input.visitId, input.entitlementId);
    const change = applyLevel(e, input.percent, ctx.now);
    const consumed = e.quantityRemaining - input.percent;
    const cost = redemptionCostCents(e, consumed);
    const updated = await applyLedgerChange(tx, e, change, { visitId: visit.id, actor: ctx.actor, at: ctx.now });
    const line = await insertLine(tx, {
      merchantId: ctx.merchantId,
      visitId: visit.id,
      itemId: e.itemId,
      name: `${e.displayName} — poured ${consumed}% (from your bottle)`,
      category: e.coveredCategory ?? "anchor",
      quantity: consumed,
      unitPriceCents: 0,
      unitCostCents: consumed > 0 ? Math.round(cost / consumed) : 0,
      lineType: "anchor_redemption",
      entitlementId: e.id,
      at: ctx.now,
    });
    if (updated.status !== "active") await cancelScheduledForEntitlement(tx, e.id, "Bottle finished", ctx.now);
    return { entitlement: updated, lines: [line], label: entitlementLabel(updated), consumed };
  });
  await sendReceipt(db, ctx, result.entitlement, `${result.consumed}% of your ${result.entitlement.displayName}`);
  return { entitlement: result.entitlement, lines: result.lines, label: result.label };
}

// ── Next-visit upsell ──────────────────────────────────────────────────────

/** Ranked add-on suggestions for the bill, built around the anchor being redeemed. */
export async function getUpsellForVisit(db: Db, ctx: FlowContext, visitId: string, limit = 4): Promise<UpsellRecommendation[]> {
  const merchant = await merchantFor(db, ctx);
  const visit = await getVisit(db, ctx.merchantId, visitId);
  assertSameMerchant(visit, ctx);
  const lines = await listLines(db, visitId);
  const catalog = await listItems(db, ctx.merchantId, { activeOnly: true });
  const redeemed = lines.find((l) => l.lineType === "anchor_redemption");
  let anchorCategory = redeemed?.category ?? null;
  if (!anchorCategory) {
    const counts = new Map<string, number>();
    for (const l of lines.filter((x) => x.lineType === "regular")) counts.set(l.category, (counts.get(l.category) ?? 0) + l.quantity);
    anchorCategory = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  const definitions = await listDefinitions(db, ctx.merchantId, { status: "active" });
  const bundles: UpsellBundle[] = definitions
    .filter((d) => d.offerType === "stored_addon" || d.offerType === "food_drink_attach")
    .map((d) => {
      const ids = (d.config.itemIds as string[] | undefined) ?? [];
      const items = catalog.filter((i) => ids.includes(i.id));
      return {
        offerDefinitionId: d.id,
        name: d.name,
        priceCents: Number(d.config.bundlePriceCents ?? 0),
        costCents: items.reduce((s, i) => s + i.costCents, 0),
        pairsWith: null,
      };
    })
    .filter((b) => b.priceCents > 0);
  return recommendUpsell({
    anchorCategory,
    catalog,
    excludeItemIds: new Set(lines.map((l) => l.itemId).filter((id): id is string => Boolean(id))),
    affinity: visit.customerId ? await categoryAffinity(db, visit.customerId) : {},
    partySize: visit.partySize,
    complements: verticalPreset(merchant.merchant.vertical).complements,
    bundles,
    limit,
    currency: merchant.merchant.currency,
    locale: merchant.merchant.locale,
  });
}

/** Staff added a suggested item or bundle. Bundles are tracked as accepted staff upsells. */
export async function addUpsell(
  db: Db,
  ctx: FlowContext,
  input: { visitId: string; itemId?: string | null; offerDefinitionId?: string | null },
): Promise<VisitLine[]> {
  return inTransaction(db, async (tx) => {
    const visit = await getVisit(tx, ctx.merchantId, input.visitId, { forUpdate: true });
    assertSameMerchant(visit, ctx);
    if (visit.status !== "open") throw new ValidationError("This bill is already closed.");
    if (input.itemId) {
      const item = await getItem(tx, ctx.merchantId, input.itemId);
      return [
        await insertLine(tx, {
          merchantId: ctx.merchantId,
          visitId: visit.id,
          itemId: item.id,
          name: item.name,
          category: item.category,
          quantity: 1,
          unitPriceCents: item.priceCents,
          unitCostCents: item.costCents,
          lineType: "regular",
          at: ctx.now,
        }),
      ];
    }
    if (!input.offerDefinitionId) throw new ValidationError("Pick an item or a bundle.");
    const def = await getDefinition(tx, ctx.merchantId, input.offerDefinitionId);
    const catalog = await listItems(tx, ctx.merchantId);
    const lines = await listLines(tx, visit.id);
    if (lines.some((l) => l.lineType === "discount" || l.lineType === "perk")) {
      throw new ValidationError("This bill already has a promotion (no stacking).");
    }
    const kind = offerKind(def.offerType);
    let offerLines;
    try {
      offerLines = kind.applyToBill(def.config, catalog, lines);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "This bundle cannot be added.");
    }
    const exposure = await insertExposure(tx, {
      merchantId: ctx.merchantId,
      decisionId: null,
      offerDefinitionId: def.id,
      visitId: visit.id,
      customerId: visit.customerId,
      campaignId: null,
      messageId: null,
      entitlementId: null,
      offerType: def.offerType,
      channel: "staff_upsell",
      isDiscount: kind.isDiscount(def.config, catalog),
      payload: { name: def.name },
      expected: {},
      status: "accepted",
      promoCostCents: kind.promoCostCents(def.config, catalog),
      valueCents: offerLines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0),
      shownAt: ctx.now,
      respondedAt: ctx.now,
      expiresAt: null,
    });
    const inserted: VisitLine[] = [];
    for (const l of offerLines) inserted.push(await insertLine(tx, { merchantId: ctx.merchantId, visitId: visit.id, ...l, offerExposureId: exposure.id, at: ctx.now }));
    return inserted;
  });
}
