import "server-only";
import { ValidationError } from "@/core/errors";
import { inTransaction, type Db } from "@/server/db";
import { coverageText } from "@/modules/anchors/labels";
import { getProgram, listEntitlements } from "@/modules/anchors/repo";
import { issueEntitlement } from "@/modules/anchors/service";
import { buildTermsSnapshot } from "@/modules/anchors/terms";
import type { EntitlementRecord } from "@/modules/anchors/repo";
import { listItems } from "@/modules/catalog/repo";
import { getCustomer } from "@/modules/customers/repo";
import { getDecision, getExposure, updateExposure } from "@/modules/offers/repo";
import { getLine, getVisit, insertLine } from "@/modules/visits/repo";
import { assertSameMerchant, claimUrl, merchantFor, type FlowContext } from "./context";
import { planAnchorMessages, sendMessageNow } from "./messages";

/**
 * MVP step 6 (customer accepts) and the bottle/bucket/package "keep" for things already
 * bought. The anchor is issued `active` when the customer is already on the bill, else
 * `pending_claim` with a QR claim link that staff show at the table (step 7).
 */

export interface IssuedAnchor {
  entitlement: EntitlementRecord;
  /** Present while the anchor waits to be claimed by scanning the QR. */
  claimToken: string | null;
  claimUrl: string | null;
}

const DAY = 86_400_000;

/** Customer accepted the checkout offer: add the +$X line and issue the anchor. */
export async function acceptOffer(db: Db, ctx: FlowContext, exposureId: string): Promise<IssuedAnchor> {
  const merchant = await merchantFor(db, ctx);
  const issued = await inTransaction(db, async (tx) => {
    const exposure = await getExposure(tx, ctx.merchantId, exposureId, { forUpdate: true });
    if (exposure.offerType !== "anchor_upgrade" || exposure.channel !== "pos" || !exposure.decisionId || !exposure.visitId) {
      throw new ValidationError("This is not a checkout anchor offer.");
    }
    if (exposure.status !== "shown") throw new ValidationError(`This offer was already ${exposure.status}.`);
    const visit = await getVisit(tx, ctx.merchantId, exposure.visitId, { forUpdate: true });
    if (visit.status !== "open") throw new ValidationError("This bill is already closed.");
    const decision = await getDecision(tx, ctx.merchantId, exposure.decisionId);
    const deal = decision.chosen;
    if (!deal) throw new ValidationError("The offer has no deal attached.");
    const program = await getProgram(tx, ctx.merchantId, deal.programId);
    const catalog = await listItems(tx, ctx.merchantId);
    const itemNames = Object.fromEntries(catalog.map((i) => [i.id, i.name]));
    const expiresAt = new Date(ctx.now.getTime() + program.validityDays * DAY);
    const quantity = deal.unitType === "percent" ? 100 : deal.units;

    const result = await issueEntitlement(tx, {
      merchantId: ctx.merchantId,
      customerId: visit.customerId,
      programId: program.id,
      originVisitId: visit.id,
      itemId: deal.itemId,
      issueMode: "upgrade_offer",
      displayName: deal.displayName,
      unitType: deal.unitType,
      unitLabel: deal.unitLabel,
      unitLabelPlural: deal.unitLabelPlural,
      quantity,
      coveredCategory: deal.coveredCategory,
      maxCoveredPriceCents: deal.maxCoveredPriceCents,
      unitRetailCents: deal.unitRetailCents,
      unitCostCents: deal.unitCostCents,
      pricePaidCents: deal.priceCents,
      storageLocation: null,
      expiresAt,
      transferable: program.transferable,
      termsSnapshot: buildTermsSnapshot({
        programName: program.name,
        coverageText: coverageText(program.coverage, { unitLabel: program.unitLabel, itemNames, currency: merchant.merchant.currency, locale: merchant.merchant.locale }),
        expiresAt,
        redemption: program.redemption,
        transferable: program.transferable,
        refundPolicy: program.refundPolicy,
        upgradeAllowed: program.upgradeAllowed,
        terms: program.terms,
        pricePaidCents: deal.priceCents,
        currency: merchant.merchant.currency,
        issuedAt: ctx.now,
      }),
      claimWindowHours: merchant.settings.anchors.claimWindowHours,
      actor: ctx.actor,
      at: ctx.now,
    });

    // The +$X is real money today; its cost is recognised when the anchor is redeemed.
    await insertLine(tx, {
      merchantId: ctx.merchantId,
      visitId: visit.id,
      itemId: deal.itemId,
      name: `${program.name} (+ ${deal.pitch.label})`,
      category: deal.coveredCategory ?? "anchor",
      quantity: 1,
      unitPriceCents: deal.priceCents,
      unitCostCents: 0,
      lineType: "anchor_upgrade",
      entitlementId: result.entitlement.id,
      offerExposureId: exposure.id,
      at: ctx.now,
    });
    await updateExposure(tx, exposure.id, {
      status: "accepted",
      respondedAt: ctx.now,
      entitlementId: result.entitlement.id,
      valueCents: deal.priceCents,
      customerId: visit.customerId,
    });
    return result;
  });

  if (issued.entitlement.customerId) {
    const customer = await getCustomer(db, ctx.merchantId, issued.entitlement.customerId);
    const { confirmation } = await planAnchorMessages(db, merchant, issued.entitlement, customer, ctx.now);
    if (confirmation) await sendMessageNow(db, confirmation.id, ctx.now);
  }
  return {
    entitlement: issued.entitlement,
    claimToken: issued.claimToken,
    claimUrl: issued.claimToken ? claimUrl(issued.claimToken) : null,
  };
}

/** Customer said no. The decision stays; there is no second offer on this bill. */
export async function declineOffer(db: Db, ctx: FlowContext, exposureId: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    const exposure = await getExposure(tx, ctx.merchantId, exposureId, { forUpdate: true });
    if (exposure.status !== "shown") throw new ValidationError(`This offer was already ${exposure.status}.`);
    await updateExposure(tx, exposure.id, { status: "declined", respondedAt: ctx.now });
  });
}

export interface KeepInput {
  visitId: string;
  /** The bill line of the thing being kept (the bottle, the bucket, the package). */
  lineId: string;
  /** The stored_purchase program to use. */
  programId: string;
  /** Units kept: percent left in the bottle, beers left in the bucket, sessions left. */
  quantity: number;
  storageLocation?: string | null;
}

/**
 * Bottle keep / bucket remainder / service package: the customer already paid for it on
 * this bill (a regular line, cost expensed now), so the anchor costs nothing more at
 * redemption. Package items contain `unitsGranted` units (a $50 bucket of 5 → $10 a beer).
 */
export async function keepStoredPurchase(db: Db, ctx: FlowContext, input: KeepInput): Promise<IssuedAnchor> {
  const merchant = await merchantFor(db, ctx);
  const issued = await inTransaction(db, async (tx) => {
    const visit = await getVisit(tx, ctx.merchantId, input.visitId, { forUpdate: true });
    assertSameMerchant(visit, ctx);
    if (visit.status !== "open") throw new ValidationError("This bill is already closed.");
    const line = await getLine(tx, ctx.merchantId, input.lineId);
    if (line.visitId !== visit.id || line.lineType !== "regular" || line.voidedAt) throw new ValidationError("Pick an item on this bill.");
    const program = await getProgram(tx, ctx.merchantId, input.programId);
    const keptFromLine = (await listEntitlements(tx, ctx.merchantId, { originVisitId: visit.id })).filter(
      (e) => e.issueMode === "stored_purchase" && e.programId === program.id && e.itemId === line.itemId && e.status !== "voided",
    ).length;
    if (keptFromLine >= line.quantity) throw new ValidationError("This item is already being kept.");
    if (program.issueMode !== "stored_purchase" || program.status !== "active") throw new ValidationError("Choose an active keep program.");
    const catalog = await listItems(tx, ctx.merchantId);
    const item = catalog.find((i) => i.id === line.itemId) ?? null;
    const covered =
      program.coverage.kind === "category" ? program.coverage.category === line.category : program.coverage.itemIds.length > 0;
    if (!covered) throw new ValidationError(`${program.name} does not cover ${line.name}.`);

    const percent = program.unitType === "percent";
    const max = percent ? 100 : program.unitsGranted * line.quantity;
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > max) {
      throw new ValidationError(percent ? "Enter the level left, 1-100%." : `Keep between 1 and ${max}.`);
    }
    const perUnit = percent || program.unitsGranted <= 1 ? 1 : program.unitsGranted;
    const unitRetail = Math.round(line.unitPriceCents / perUnit);
    const unitCost = Math.round(line.unitCostCents / perUnit);
    const coveredItems = program.coverage.kind === "items" ? catalog.filter((i) => (program.coverage as { itemIds: string[] }).itemIds.includes(i.id)) : [];
    const coveredCategory = program.coverage.kind === "category" ? program.coverage.category : (coveredItems[0]?.category ?? line.category);
    const displayName = percent ? line.name : program.unitLabel;
    const expiresAt = new Date(ctx.now.getTime() + program.validityDays * DAY);
    const itemNames = Object.fromEntries(catalog.map((i) => [i.id, i.name]));

    const result = await issueEntitlement(tx, {
      merchantId: ctx.merchantId,
      customerId: visit.customerId,
      programId: program.id,
      originVisitId: visit.id,
      itemId: item?.id ?? null,
      issueMode: "stored_purchase",
      displayName,
      unitType: program.unitType,
      unitLabel: program.unitLabel,
      unitLabelPlural: program.unitLabelPlural,
      quantity: input.quantity,
      coveredCategory,
      maxCoveredPriceCents: null,
      unitRetailCents: unitRetail,
      unitCostCents: unitCost,
      pricePaidCents: 0,
      storageLocation: input.storageLocation?.trim() || null,
      expiresAt,
      transferable: program.transferable,
      termsSnapshot: buildTermsSnapshot({
        programName: program.name,
        coverageText: percent ? line.name : coverageText(program.coverage, { unitLabel: program.unitLabel, itemNames, currency: merchant.merchant.currency, locale: merchant.merchant.locale }),
        expiresAt,
        redemption: program.redemption,
        transferable: program.transferable,
        refundPolicy: program.refundPolicy,
        upgradeAllowed: program.upgradeAllowed,
        terms: program.terms,
        pricePaidCents: 0,
        currency: merchant.merchant.currency,
        issuedAt: ctx.now,
      }),
      claimWindowHours: merchant.settings.anchors.claimWindowHours,
      actor: ctx.actor,
      at: ctx.now,
    });
    return result;
  });

  if (issued.entitlement.customerId) {
    const customer = await getCustomer(db, ctx.merchantId, issued.entitlement.customerId);
    const { confirmation } = await planAnchorMessages(db, merchant, issued.entitlement, customer, ctx.now);
    if (confirmation) await sendMessageNow(db, confirmation.id, ctx.now);
  }
  return {
    entitlement: issued.entitlement,
    claimToken: issued.claimToken,
    claimUrl: issued.claimToken ? claimUrl(issued.claimToken) : null,
  };
}
