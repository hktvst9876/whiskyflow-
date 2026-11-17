import "server-only";
import { ValidationError } from "@/core/errors";
import { inTransaction, type Db } from "@/server/db";
import { coverageText } from "@/modules/anchors/labels";
import { getProgram, listEntitlements, listPrograms } from "@/modules/anchors/repo";
import type { AnchorProgram } from "@/modules/anchors/types";
import type { VisitLine } from "@/modules/visits/types";
import { issueEntitlement } from "@/modules/anchors/service";
import { buildTermsSnapshot } from "@/modules/anchors/terms";
import type { EntitlementRecord } from "@/modules/anchors/repo";
import { listItems } from "@/modules/catalog/repo";
import { getCustomer } from "@/modules/customers/repo";
import { getDecision, getExposure, updateExposure } from "@/modules/offers/repo";
import { getLine, getVisit, insertLine, listLines } from "@/modules/visits/repo";
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
    if (program.issueMode !== "stored_purchase" || program.status !== "active") throw new ValidationError("Choose an active keep program.");
    const catalog = await listItems(tx, ctx.merchantId);
    const item = catalog.find((i) => i.id === line.itemId) ?? null;
    const covered = keepApplies(program, line);
    if (!covered) throw new ValidationError(`${program.name} does not cover ${line.name}.`);
    // One keep per unit sold: a bill with two bottles can keep two, never one bottle twice.
    const sold = (await listLines(tx, visit.id)).filter((l) => l.lineType === "regular" && keepApplies(program, l)).reduce((n, l) => n + l.quantity, 0);
    const kept = (await listEntitlements(tx, ctx.merchantId, { originVisitId: visit.id })).filter(
      (e) => e.issueMode === "stored_purchase" && e.programId === program.id && e.status !== "voided",
    ).length;
    if (kept >= sold) throw new ValidationError("This item is already being kept.");

    const percent = program.unitType === "percent";
    const max = percent ? 100 : program.unitsGranted * line.quantity;
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > max) {
      throw new ValidationError(percent ? "Enter the level left, 1-100%." : `Keep between 1 and ${max}.`);
    }
    const perUnit = percent || program.unitsGranted <= 1 ? 1 : program.unitsGranted;
    const unitRetail = Math.round(line.unitPriceCents / perUnit);
    const unitCost = Math.round(line.unitCostCents / perUnit);
    // What the kept units are, e.g. 60-minute massages from a "3-Massage package".
    const coveredItem =
      program.coverage.kind === "items" ? (program.coverage.itemIds.map((id) => catalog.find((i) => i.id === id)).find(Boolean) ?? null) : null;
    const coveredCategory = program.coverage.kind === "category" ? program.coverage.category : (coveredItem?.category ?? line.category);
    const displayName = percent ? line.name : program.unitLabel;
    const expiresAt = new Date(ctx.now.getTime() + program.validityDays * DAY);
    const itemNames = Object.fromEntries(catalog.map((i) => [i.id, i.name]));

    const result = await issueEntitlement(tx, {
      merchantId: ctx.merchantId,
      customerId: visit.customerId,
      programId: program.id,
      originVisitId: visit.id,
      itemId: (percent ? item?.id : (coveredItem?.id ?? item?.id)) ?? null,
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

/** Does a keep programme apply to this bill line? */
export function keepApplies(program: AnchorProgram, line: Pick<VisitLine, "itemId" | "category">): boolean {
  const sold = program.trigger.requiredItemIds;
  if (sold && sold.length > 0) return line.itemId !== null && sold.includes(line.itemId);
  if (program.coverage.kind === "category") return program.coverage.category === line.category;
  return line.itemId !== null && program.coverage.itemIds.includes(line.itemId);
}

export interface KeepOption {
  lineId: string;
  lineName: string;
  programId: string;
  programName: string;
  unitType: AnchorProgram["unitType"];
  unitLabelPlural: string;
  /** Most that can be kept: 100 (%) for a bottle, units in the package otherwise. */
  max: number;
}

/** Bill lines the guest could leave part of behind (bottle, bucket, package). */
export async function keepOptionsForVisit(db: Db, ctx: FlowContext, visitId: string): Promise<KeepOption[]> {
  const visit = await getVisit(db, ctx.merchantId, visitId);
  if (visit.status !== "open") return [];
  const programs = (await listPrograms(db, ctx.merchantId, { status: "active" })).filter((p) => p.issueMode === "stored_purchase");
  if (programs.length === 0) return [];
  const lines = (await listLines(db, visitId)).filter((l) => l.lineType === "regular");
  const keptByProgram = new Map<string, number>();
  for (const e of await listEntitlements(db, ctx.merchantId, { originVisitId: visitId })) {
    if (e.issueMode === "stored_purchase" && e.programId && e.status !== "voided") keptByProgram.set(e.programId, (keptByProgram.get(e.programId) ?? 0) + 1);
  }
  const options: KeepOption[] = [];
  for (const program of programs) {
    const matching = lines.filter((l) => keepApplies(program, l));
    let remaining = matching.reduce((n, l) => n + l.quantity, 0) - (keptByProgram.get(program.id) ?? 0);
    for (const line of matching) {
      if (remaining <= 0) break;
      remaining -= line.quantity;
      options.push({
        lineId: line.id,
        lineName: line.name,
        programId: program.id,
        programName: program.name,
        unitType: program.unitType,
        unitLabelPlural: program.unitLabelPlural,
        max: program.unitType === "percent" ? 100 : program.unitsGranted,
      });
    }
  }
  return options;
}
