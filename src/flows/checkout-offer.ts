import "server-only";
import { eq } from "drizzle-orm";
import { ValidationError } from "@/core/errors";
import type { Db } from "@/server/db";
import { listPrograms, openAnchorCount, outstandingLiabilityCents } from "@/modules/anchors/repo";
import { listItems } from "@/modules/catalog/repo";
import { DEAL_POLICY_VERSION, evaluateDeals } from "@/modules/deals/engine";
import type { Basket, DealCandidate, MerchantBaseline } from "@/modules/deals/types";
import { assignmentUnit } from "@/modules/experiments/assign";
import { assignUnit, ensureExperiment } from "@/modules/experiments/repo";
import { CHECKOUT_EXPERIMENT_KEY, type Arm } from "@/modules/experiments/types";
import { evaluateGuardrails } from "@/modules/guardrails/evaluate";
import type { GuardrailResult } from "@/modules/guardrails/types";
import { appState } from "@/modules/merchants/schema";
import type { MerchantContext } from "@/modules/merchants/repo";
import { exposureFactsForCustomer, exposuresForDecision, getDecisionForVisit, insertDecisionOnce, insertExposure } from "@/modules/offers/repo";
import type { DecisionContext, DecisionOutcome, OfferDecision, OfferExposure } from "@/modules/offers/types";
import { getVisit, listLines, merchantVisitBaseline } from "@/modules/visits/repo";
import { computeTotals } from "@/modules/visits/totals";
import { assertSameMerchant, blackoutReason, merchantFor, type FlowContext } from "./context";
import { customerSnapshot, dealCustomerFrom, type CustomerSnapshot } from "./scoring";

/**
 * MVP steps 2-5: the customer orders normally; before payment the system analyses the
 * basket, finds the most profitable Return Anchor upgrade, checks the guardrails, applies
 * the randomised holdout and shows staff ONE offer ("Offer +$8 → 1 Main Waiting").
 *
 * One decision per visit, never re-rolled: re-evaluating returns the stored decision, so
 * staff cannot fish for a better offer and the experiment stays clean. The holdout is
 * assigned only for eligible opportunities ("would have been offered"), which is the
 * comparison the lift report needs.
 */

export interface CheckoutOfferView {
  decision: OfferDecision;
  /** The exposure staff act on (accept/decline). Null for holdout/no_eligible/blocked. */
  exposure: OfferExposure | null;
  candidate: DealCandidate | null;
  /** Plain-language reason when there is no offer to show. */
  reason: string;
}

/** Key in app_state holding the measured uplift per merchant (written by the scheduler). */
export const measuredUpliftKey = (merchantId: string) => `measured_uplift:${merchantId}`;

async function readMeasuredUplift(db: Db, merchant: MerchantContext): Promise<number | null> {
  if (!merchant.settings.dealEngine.useMeasuredLift) return null;
  const [row] = await db.select().from(appState).where(eq(appState.key, measuredUpliftKey(merchant.merchant.id)));
  return typeof row?.value === "number" ? row.value : null;
}

/** Merchant baseline for G; a young merchant uses tonight's bill as "a normal visit". */
async function baselineFor(db: Db, merchant: MerchantContext, basket: Basket, now: Date): Promise<MerchantBaseline> {
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const b = await merchantVisitBaseline(db, merchant.merchant.id, since, now);
  if (b.visits >= 20) return { avgVisitGpCents: b.avgGpCents, avgVisitSpendCents: b.avgSpendCents };
  const revenue = basket.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const cost = basket.lines.reduce((s, l) => s + l.unitCostCents * l.quantity, 0);
  return { avgVisitGpCents: Math.max(b.avgGpCents, revenue - cost), avgVisitSpendCents: Math.max(b.avgSpendCents, revenue) };
}

function reasonFor(outcome: DecisionOutcome, candidates: DealCandidate[], blocked: GuardrailResult[]): string {
  switch (outcome) {
    case "offered":
      return "";
    case "holdout":
      return "Holdout: no offer this time, so we can measure what anchors really add.";
    case "blocked":
      return blocked.map((b) => b.reason).join("; ") || "Blocked by a guardrail.";
    default: {
      const first = candidates.find((c) => c.reasons.length > 0);
      return first ? `No profitable anchor: ${first.reasons[0]}` : "No anchor program fits this bill.";
    }
  }
}

async function viewFor(db: Db, decision: OfferDecision): Promise<CheckoutOfferView> {
  const exposures = await exposuresForDecision(db, decision.id);
  const blocked = (decision.context.guardrails ?? []).filter((g) => !g.passed).map((g) => ({ key: g.key, label: g.key, critical: false, passed: false, reason: g.reason }));
  return {
    decision,
    exposure: exposures[0] ?? null,
    candidate: decision.chosen,
    reason: reasonFor(decision.outcome, decision.candidates, blocked),
  };
}

/** The stored decision for a visit, if the offer has already been evaluated. */
export async function getCheckoutOffer(db: Db, ctx: FlowContext, visitId: string): Promise<CheckoutOfferView | null> {
  const visit = await getVisit(db, ctx.merchantId, visitId);
  assertSameMerchant(visit, ctx);
  const decision = await getDecisionForVisit(db, visitId);
  return decision ? viewFor(db, decision) : null;
}

/**
 * Evaluate the checkout offer for an open visit. Returns null (and stores nothing) when
 * the bill has no regular items yet or the deal engine is switched off.
 */
export async function evaluateCheckoutOffer(db: Db, ctx: FlowContext, visitId: string): Promise<CheckoutOfferView | null> {
  const visit = await getVisit(db, ctx.merchantId, visitId);
  assertSameMerchant(visit, ctx);
  const existing = await getDecisionForVisit(db, visitId);
  if (existing) return viewFor(db, existing);
  if (visit.status !== "open") throw new ValidationError("This bill is already closed.");

  const merchant = await merchantFor(db, ctx);
  if (!merchant.settings.dealEngine.enabled) return null;
  const lines = await listLines(db, visitId);
  const regular = lines.filter((l) => l.lineType === "regular");
  if (regular.length === 0) return null;

  const basket: Basket = {
    lines: regular.map((l) => ({ itemId: l.itemId, category: l.category, quantity: l.quantity, unitPriceCents: l.unitPriceCents, unitCostCents: l.unitCostCents })),
    partySize: visit.partySize,
  };
  const [catalog, programs] = await Promise.all([listItems(db, ctx.merchantId, { activeOnly: true }), listPrograms(db, ctx.merchantId, { status: "active" })]);
  let snap: CustomerSnapshot | null = null;
  if (visit.customerId) snap = await customerSnapshot(db, merchant, visit.customerId, ctx.now);

  const result = evaluateDeals(
    {
      basket,
      catalog,
      programs,
      customer: snap ? dealCustomerFrom(snap) : null,
      baseline: await baselineFor(db, merchant, basket, ctx.now),
      settings: merchant.settings,
      measuredUplift: await readMeasuredUplift(db, merchant),
    },
    merchant.merchant.currency,
    merchant.merchant.locale,
  );

  const context: DecisionContext = {
    basketRevenueCents: computeTotals(regular).newCashRevenueCents,
    basketCostCents: computeTotals(regular).newCashCostCents,
    partySize: visit.partySize,
    segment: snap?.segment ?? null,
    p0: result.best?.p0 ?? snap?.p0 ?? merchant.settings.dealEngine.newCustomerReturnPrior,
    identified: Boolean(visit.customerId),
  };

  let outcome: DecisionOutcome = "no_eligible";
  let blocked: GuardrailResult[] = [];
  let experimentId: string | null = null;
  let arm: Arm | null = null;
  const best = result.best;

  if (best) {
    const history = visit.customerId ? await exposureFactsForCustomer(db, visit.customerId, ctx.now) : [];
    const evaluation = evaluateGuardrails(
      {
        now: ctx.now,
        kind: "checkout_offer",
        offer: {
          offerType: "anchor_upgrade",
          isDiscount: false,
          promoCostCents: 0,
          isWinBack: false,
          deal: {
            deltaECents: best.deltaECents,
            todayMarginRate: best.todayMarginRate,
            depth: best.depth,
            coveredRetailCents: best.coveredRetailCents,
            perVisitCoveredRetailCents: best.perVisitCoveredRetailCents,
            expectedNextVisitSpendCents: best.expectedNextVisitSpendCents,
          },
        },
        customer: {
          identified: Boolean(visit.customerId),
          segment: snap?.segment ?? null,
          activeAnchorCount: visit.customerId ? await openAnchorCount(db, visit.customerId) : 0,
        },
        history,
        visit: { hasOtherPromo: lines.some((l) => l.lineType === "perk" || l.lineType === "discount" || l.lineType === "anchor_upgrade") },
        merchant: {
          outstandingLiabilityCents: await outstandingLiabilityCents(db, ctx.merchantId),
          addedLiabilityCents: best.coveredRetailCents,
          blackoutReason: blackoutReason(merchant.settings.business.blackouts, ctx.now, merchant.merchant.timezone),
        },
      },
      merchant.settings,
    );
    context.guardrails = evaluation.results.filter((r) => !r.skipped).map((r) => ({ key: r.key, passed: r.passed, reason: r.reason }));
    if (!evaluation.allowed) {
      outcome = "blocked";
      blocked = evaluation.blockedBy;
    } else if (merchant.settings.experiment.enabled) {
      const experiment = await ensureExperiment(db, {
        merchantId: ctx.merchantId,
        key: CHECKOUT_EXPERIMENT_KEY,
        name: "Checkout Return Anchor offers",
        holdoutRate: merchant.settings.experiment.holdoutRate,
        at: ctx.now,
      });
      experimentId = experiment.id;
      const unit = assignmentUnit(visit.id, visit.customerId);
      arm = (await assignUnit(db, experiment, { ...unit, customerId: visit.customerId, visitId: visit.id, at: ctx.now })).arm;
      outcome = arm === "holdout" ? "holdout" : "offered";
    } else {
      outcome = "offered";
    }
  }

  const { decision, created } = await insertDecisionOnce(db, {
    merchantId: ctx.merchantId,
    visitId: visit.id,
    customerId: visit.customerId,
    experimentId,
    arm,
    identifiedAtAssignment: Boolean(visit.customerId),
    outcome,
    chosen: best,
    candidates: result.candidates,
    context,
    policyVersion: DEAL_POLICY_VERSION,
    at: ctx.now,
  });
  if (!created) return viewFor(db, decision);

  let exposure: OfferExposure | null = null;
  if (outcome === "offered" && best) {
    exposure = await insertExposure(db, {
      merchantId: ctx.merchantId,
      decisionId: decision.id,
      offerDefinitionId: null,
      visitId: visit.id,
      customerId: visit.customerId,
      campaignId: null,
      messageId: null,
      entitlementId: null,
      offerType: "anchor_upgrade",
      channel: "pos",
      isDiscount: false,
      payload: { programId: best.programId, priceCents: best.priceCents, pitch: best.pitch },
      expected: { deltaECents: best.deltaECents, pAccept: best.pAccept, expectedValueCents: best.expectedValueCents },
      status: "shown",
      promoCostCents: 0,
      valueCents: best.priceCents,
      shownAt: ctx.now,
      expiresAt: null,
    });
  }
  return { decision, exposure, candidate: best, reason: reasonFor(outcome, result.candidates, blocked) };
}
