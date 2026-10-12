/**
 * Dynamic deal engine (pure). Answers: "what small extra payment today creates
 * meaningful unfinished value for the next visit — profitably?"
 *
 * For each active upgrade_offer program whose trigger matches the basket:
 *   1. Covered unit retail/cost (conservative: highest cost among eligible items).
 *   2. Price ladder U within the program's [minPriceRate, maxPriceRate].
 *   3. p0 (return probability without anchor) → uplift prior → p1.
 *   4. G (normal next-visit GP) → Gnew = G − s·(coveredRetail − C) + upsellGpPrior.
 *   5. ΔE = U − C + p1·Gnew − p0·G − perkCost   (C counted in full: no breakage credit)
 *   6. pAccept = baseAccept[segment] · sigmoid((depth − d0)/k)
 *   7. Hard constraints: min ΔE, min today margin, max depth, anchor value cap.
 *   8. Best price point maximises pAccept·ΔE; programs ranked by that value.
 * See docs/architecture/blueprint.md §7.1.
 */
import { formatMoney, roundUpTo } from "@/core/money";
import { coverageText, entitlementLabel } from "../anchors/labels";
import type { AnchorProgram } from "../anchors/types";
import type { CatalogItem } from "../catalog/types";
import { sigmoid } from "../scoring/score";
import type { Basket, DealCandidate, DealInput, DealResult } from "./types";

/** Bump when the decision logic changes; stored on every decision for analysis. */
export const DEAL_POLICY_VERSION = "deal-engine/1.0";

export interface CoveredUnit {
  unitRetailCents: number;
  unitCostCents: number;
  itemId: string | null;
  eligibleItemIds: string[];
}

/** Step 1: what one covered unit is worth, conservatively. Null when nothing is covered. */
export function coveredUnit(program: AnchorProgram, catalog: CatalogItem[]): CoveredUnit | null {
  const active = catalog.filter((i) => i.active);
  if (program.coverage.kind === "items") {
    const ids = new Set(program.coverage.itemIds);
    const items = active.filter((i) => ids.has(i.id));
    if (items.length === 0) return null;
    const top = items.reduce((a, b) => (b.priceCents > a.priceCents ? b : a));
    return {
      unitRetailCents: Math.max(...items.map((i) => i.priceCents)),
      unitCostCents: Math.max(...items.map((i) => i.costCents)),
      itemId: items.length === 1 ? top.id : null,
      eligibleItemIds: items.map((i) => i.id),
    };
  }
  const { category, maxCoveredPriceCents } = program.coverage;
  const inCategory = active.filter((i) => i.category === category);
  if (inCategory.length === 0) return null;
  const cap = maxCoveredPriceCents ?? Number.POSITIVE_INFINITY;
  const eligible = inCategory.filter((i) => i.priceCents <= cap);
  if (eligible.length === 0) return null;
  const maxPrice = Math.max(...inCategory.map((i) => i.priceCents));
  const unitRetail = Math.min(cap, maxPrice);
  return {
    unitRetailCents: unitRetail,
    unitCostCents: Math.max(...eligible.map((i) => i.costCents)),
    itemId: null,
    eligibleItemIds: eligible.map((i) => i.id),
  };
}

/** Does the program's trigger match the current basket? Returns the failure reasons. */
export function triggerFailures(program: AnchorProgram, basket: Basket, currency: string): string[] {
  const t = program.trigger;
  const reasons: string[] = [];
  const revenue = basketRevenue(basket);
  if (t.minBasketCents && revenue < t.minBasketCents) {
    reasons.push(`Basket below ${formatMoney(t.minBasketCents, { currency, compact: true })}`);
  }
  if (t.minPartySize && basket.partySize < t.minPartySize) reasons.push(`Party smaller than ${t.minPartySize}`);
  if (t.requiredCategoryCounts) {
    for (const [category, count] of Object.entries(t.requiredCategoryCounts)) {
      const have = basket.lines.filter((l) => l.category === category).reduce((s, l) => s + l.quantity, 0);
      if (have < count) reasons.push(`Needs ${count} × ${category} (has ${have})`);
    }
  }
  if (t.requiredItemIds && t.requiredItemIds.length > 0) {
    const ids = new Set(basket.lines.map((l) => l.itemId));
    if (!t.requiredItemIds.some((id) => ids.has(id))) reasons.push("Required item not in basket");
  }
  return reasons;
}

export function basketRevenue(basket: Basket): number {
  return basket.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
}

export function basketCost(basket: Basket): number {
  return basket.lines.reduce((s, l) => s + l.unitCostCents * l.quantity, 0);
}

/** Price ladder (step 2): unique rounded prices within the program's bounds. */
export function priceLadder(coveredRetailCents: number, program: AnchorProgram, ladderRates: readonly number[], roundingCents: number) {
  const { minPriceRate, maxPriceRate } = program.pricing;
  const seen = new Set<number>();
  const points: { priceCents: number; priceRate: number }[] = [];
  for (const rate of ladderRates) {
    if (rate < minPriceRate - 1e-9 || rate > maxPriceRate + 1e-9) continue;
    const price = roundUpTo(Math.round(coveredRetailCents * rate), roundingCents);
    if (price <= 0 || price >= coveredRetailCents || seen.has(price)) continue;
    seen.add(price);
    points.push({ priceCents: price, priceRate: price / coveredRetailCents });
  }
  return points;
}

/** Uplift prior: persuadables in the middle gain most; near-certain and lost customers gain little. */
export function upliftPrior(p0: number, maxUplift: number): number {
  return maxUplift * 4 * p0 * (1 - p0);
}

export function evaluateDeals(input: DealInput, currency = "SGD", locale = "en-SG"): DealResult {
  const { basket, catalog, customer, baseline, settings } = input;
  const de = settings.dealEngine;
  const gr = settings.guardrails;
  const revenue = basketRevenue(basket);
  const cost = basketCost(basket);
  const itemNames = Object.fromEntries(catalog.map((i) => [i.id, i.name]));

  const p0 = customer?.p0 ?? de.newCustomerReturnPrior;
  const segment = customer?.segment ?? "new";
  const measured = input.measuredUplift;
  const uplift = measured !== undefined && measured !== null ? Math.max(0, measured) : upliftPrior(p0, de.maxUplift);
  const upliftSource: DealCandidate["upliftSource"] = measured !== undefined && measured !== null ? "measured" : "prior";
  const p1 = Math.min(de.maxReturnProbability, p0 + uplift);

  // G: customer's own average once they have history, else the merchant baseline.
  const G =
    customer && customer.visitCount >= 2 && customer.avgVisitGpCents !== null ? customer.avgVisitGpCents : baseline.avgVisitGpCents;
  const expectedNextVisitSpend =
    customer && customer.visitCount >= 2 && customer.avgVisitSpendCents !== null
      ? customer.avgVisitSpendCents
      : Math.max(baseline.avgVisitSpendCents, revenue);
  const perkCost = input.perkCostCents ?? 0;
  const baseAccept = de.baseAcceptance[segment];

  const candidates: DealCandidate[] = [];
  for (const program of input.programs) {
    if (program.status !== "active" || program.issueMode !== "upgrade_offer") continue;

    const unit = coveredUnit(program, catalog);
    const label = entitlementLabel({
      unitType: program.unitType,
      quantityRemaining: program.unitsGranted,
      unitLabel: program.unitLabel,
      unitLabelPlural: program.unitLabelPlural,
      displayName: program.unitLabel,
    });
    const coverage = coverageText(program.coverage, { unitLabel: program.unitLabel, itemNames, currency, locale });
    const base: DealCandidate = {
      programId: program.id,
      programName: program.name,
      unitType: program.unitType,
      unitLabel: program.unitLabel,
      unitLabelPlural: program.unitLabelPlural,
      displayName: unit?.itemId ? (itemNames[unit.itemId] ?? program.unitLabel) : program.unitLabel,
      units: program.unitsGranted,
      coveredCategory: program.coverage.kind === "category" ? program.coverage.category : null,
      coveredItemIds: program.coverage.kind === "items" ? program.coverage.itemIds : null,
      maxCoveredPriceCents: program.coverage.kind === "category" ? (program.coverage.maxCoveredPriceCents ?? null) : null,
      itemId: unit?.itemId ?? null,
      unitRetailCents: unit?.unitRetailCents ?? 0,
      unitCostCents: unit?.unitCostCents ?? 0,
      coveredRetailCents: 0,
      coveredCostCents: 0,
      priceCents: 0,
      priceRate: 0,
      depth: 0,
      p0,
      p1,
      uplift,
      upliftSource,
      baselineGpCents: Math.round(G),
      anchoredGpCents: 0,
      deltaECents: 0,
      pAccept: 0,
      expectedValueCents: 0,
      todayMarginRate: 0,
      expectedNextVisitSpendCents: Math.round(expectedNextVisitSpend),
      eligible: false,
      reasons: [],
      pricePointsTried: 0,
      pitch: { label, staff: "", script: "", coverage },
    };

    const triggerReasons = triggerFailures(program, basket, currency);
    if (triggerReasons.length > 0) {
      candidates.push({ ...base, reasons: triggerReasons });
      continue;
    }
    if (!unit) {
      candidates.push({ ...base, reasons: ["No active items are covered by this program"] });
      continue;
    }

    // Units: percent programs grant a whole bottle (100) priced on one unit of retail.
    const unitsForValue = program.unitType === "percent" ? 1 : program.unitsGranted;
    const coveredRetail = unitsForValue * unit.unitRetailCents;
    const C = unitsForValue * unit.unitCostCents;
    const Gnew = G - de.substitutionRate * (coveredRetail - C) + de.upsellGpPriorCents;

    const ladder = priceLadder(coveredRetail, program, de.priceLadderRates, de.roundingCents);
    if (ladder.length === 0) {
      candidates.push({ ...base, coveredRetailCents: coveredRetail, coveredCostCents: C, reasons: ["No price point within the program's price range"] });
      continue;
    }

    let best: DealCandidate | null = null;
    const failureCounts = new Map<string, number>();
    const anchorCapFails = coveredRetail > gr.anchorValueCapRate * expectedNextVisitSpend;
    for (const point of ladder) {
      const U = point.priceCents;
      const depth = 1 - U / coveredRetail;
      const deltaE = U - C + p1 * Gnew - p0 * G - perkCost;
      const pAccept = baseAccept * sigmoid((depth - de.acceptanceMidpointDepth) / de.acceptanceSteepness);
      const todayMargin = (revenue + U - cost - C) / (revenue + U);
      const failures: string[] = [];
      if (deltaE < gr.minExpectedContributionCents) failures.push("Expected contribution below minimum");
      if (todayMargin < gr.minTodayMarginRate) failures.push("Today's margin below minimum");
      if (depth > gr.maxImpliedDiscountRate) failures.push("Implied discount too deep");
      if (anchorCapFails) failures.push("Anchor would cover too much of the next visit");
      for (const f of failures) failureCounts.set(f, (failureCounts.get(f) ?? 0) + 1);
      if (failures.length > 0) continue;
      const ev = pAccept * deltaE;
      if (!best || ev > best.expectedValueCents) {
        best = {
          ...base,
          coveredRetailCents: coveredRetail,
          coveredCostCents: C,
          priceCents: U,
          priceRate: point.priceRate,
          depth,
          anchoredGpCents: Math.round(Gnew),
          deltaECents: Math.round(deltaE),
          pAccept,
          expectedValueCents: Math.round(ev),
          todayMarginRate: todayMargin,
          eligible: true,
          pricePointsTried: ladder.length,
        };
      }
    }

    if (best) {
      const price = formatMoney(best.priceCents, { currency, locale, compact: true, signed: true });
      const priceWords = formatMoney(best.priceCents, { currency, locale, compact: true });
      best.pitch = {
        label,
        coverage,
        staff: `Offer ${price} → ${label}`,
        script: scriptFor(program, label, priceWords),
      };
      candidates.push(best);
    } else {
      const reasons = [...failureCounts.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
      candidates.push({ ...base, coveredRetailCents: coveredRetail, coveredCostCents: C, pricePointsTried: ladder.length, reasons });
    }
  }

  candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.expectedValueCents - a.expectedValueCents);
  const best = candidates.find((c) => c.eligible) ?? null;
  return { best, candidates };
}

function scriptFor(program: AnchorProgram, label: string, price: string): string {
  const n = program.unitsGranted;
  const what = program.unitType === "percent" ? "the rest of the bottle" : `${n} ${(n === 1 ? program.unitLabel : program.unitLabelPlural).toLowerCase()}`;
  return `For another ${price}, enjoy everything tonight and we'll keep ${what} for your next visit — it'll show as "${label}" on your phone.`;
}
