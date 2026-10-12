import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import type { AnchorProgram } from "../anchors/types";
import type { CatalogItem } from "../catalog/types";
import { parseSettings } from "../merchants/settings";
import { coveredUnit, evaluateDeals, priceLadder, upliftPrior } from "./engine";
import type { Basket } from "./types";

const settings = parseSettings({});

function item(id: string, category: string, price: number, cost: number, extra: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id,
    merchantId: "m",
    name: id,
    category,
    kind: "product",
    priceCents: price,
    costCents: cost,
    active: true,
    anchorable: true,
    tags: [],
    description: null,
    sortOrder: 0,
    ...extra,
  };
}

const catalog: CatalogItem[] = [
  item("chicken", "main", 2200, 700),
  item("pasta", "main", 2000, 550),
  item("steak-frites", "main", 2400, 800),
  item("ribeye", "main", 3800, 1500, { tags: ["premium"] }),
  item("fries", "side", 700, 150),
  item("salad", "side", 800, 200),
  item("pint", "beer", 1200, 300),
  item("wings", "food", 1600, 450),
];

function program(overrides: Partial<AnchorProgram> = {}): AnchorProgram {
  return {
    id: "p-main",
    merchantId: "m",
    name: "3-Main Set — keep 1 main",
    status: "active",
    issueMode: "upgrade_offer",
    unitType: "item",
    unitLabel: "Main",
    unitLabelPlural: "Mains",
    unitsGranted: 1,
    coverage: { kind: "category", category: "main", maxCoveredPriceCents: 2400 },
    trigger: { requiredCategoryCounts: { main: 2 } },
    pricing: { minPriceRate: 0.25, maxPriceRate: 0.5 },
    validityDays: 60,
    redemption: {},
    transferable: false,
    refundPolicy: "unused_within_14_days",
    upgradeAllowed: true,
    terms: "",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

// The brief's example: 2 mains + 2 sides ≈ $58.
const basket: Basket = {
  partySize: 2,
  lines: [
    { itemId: "chicken", category: "main", quantity: 1, unitPriceCents: 2200, unitCostCents: 700 },
    { itemId: "pasta", category: "main", quantity: 1, unitPriceCents: 2000, unitCostCents: 550 },
    { itemId: "fries", category: "side", quantity: 1, unitPriceCents: 700, unitCostCents: 150 },
    { itemId: "salad", category: "side", quantity: 1, unitPriceCents: 800, unitCostCents: 200 },
  ],
};

const baseline = { avgVisitGpCents: 3500, avgVisitSpendCents: 5800 };

describe("coveredUnit", () => {
  it("caps category coverage at the max covered price and uses the highest eligible cost", () => {
    const unit = coveredUnit(program(), catalog);
    assert.equal(unit?.unitRetailCents, 2400);
    assert.equal(unit?.unitCostCents, 800); // ribeye ($38, cost $15) is above the cap so excluded
    assert.ok(!unit?.eligibleItemIds.includes("ribeye"));
  });

  it("returns null when nothing in the category is affordable", () => {
    assert.equal(coveredUnit(program({ coverage: { kind: "category", category: "main", maxCoveredPriceCents: 500 } }), catalog), null);
  });

  it("uses the max price and cost among listed items", () => {
    const unit = coveredUnit(program({ coverage: { kind: "items", itemIds: ["pint"] } }), catalog);
    assert.deepEqual([unit?.unitRetailCents, unit?.unitCostCents, unit?.itemId], [1200, 300, "pint"]);
  });
});

describe("priceLadder", () => {
  it("keeps prices inside the program range, rounded up and unique", () => {
    const points = priceLadder(2400, program(), DEFAULT_SETTINGS.dealEngine.priceLadderRates, 100);
    assert.deepEqual(
      points.map((p) => p.priceCents),
      [600, 800, 900, 1000, 1100, 1200],
    );
  });
});

describe("upliftPrior", () => {
  it("peaks for persuadable customers and vanishes at the extremes", () => {
    assert.equal(upliftPrior(0.5, 0.2), 0.2);
    assert.ok(upliftPrior(0.95, 0.2) < 0.04);
    assert.ok(upliftPrior(0.02, 0.2) < 0.02);
  });
});

describe("evaluateDeals", () => {
  it("recommends a profitable '+$X → 1 Main Waiting' for the brief's restaurant basket", () => {
    const result = evaluateDeals({ basket, catalog, programs: [program()], customer: null, baseline, settings });
    const best = result.best;
    assert.ok(best, "expected an offer");
    assert.equal(best.pitch.label, "1 Main Waiting");
    assert.match(best.pitch.staff, /^Offer \+\$\d+ → 1 Main Waiting$/);
    // ΔE = U − C + p1·Gnew − p0·G must be recomputable from the parts.
    const recomputed = best.priceCents - best.coveredCostCents + best.p1 * best.anchoredGpCents - best.p0 * best.baselineGpCents;
    assert.ok(Math.abs(recomputed - best.deltaECents) <= 1);
    assert.ok(best.deltaECents >= settings.guardrails.minExpectedContributionCents);
    assert.ok(best.todayMarginRate >= settings.guardrails.minTodayMarginRate);
    assert.ok(best.priceCents >= 600 && best.priceCents <= 1200);
    // Never counts breakage: the full cost of the stored main is in C.
    assert.equal(best.coveredCostCents, 800);
  });

  it("does not offer when the trigger is not met", () => {
    const small: Basket = { partySize: 1, lines: [basket.lines[0]!] };
    const result = evaluateDeals({ basket: small, catalog, programs: [program()], customer: null, baseline, settings });
    assert.equal(result.best, null);
    assert.match(result.candidates[0]!.reasons[0]!, /Needs 2 × main/);
  });

  it("does not subsidise near-certain regulars with deep discounts, but does for persuadables", () => {
    const deep = program({ pricing: { minPriceRate: 0.25, maxPriceRate: 0.3 } });
    const regular = { p0: 0.95, segment: "likely_regular" as const, visitCount: 12, avgVisitGpCents: 3500, avgVisitSpendCents: 5800 };
    const persuadable = { p0: 0.45, segment: "persuadable" as const, visitCount: 4, avgVisitGpCents: 3500, avgVisitSpendCents: 5800 };
    const forRegular = evaluateDeals({ basket, catalog, programs: [deep], customer: regular, baseline, settings });
    assert.equal(forRegular.best, null);
    assert.ok(forRegular.candidates[0]!.reasons.includes("Expected contribution below minimum"));
    const forPersuadable = evaluateDeals({ basket, catalog, programs: [deep], customer: persuadable, baseline, settings });
    assert.ok(forPersuadable.best);
    assert.ok(forPersuadable.best.uplift > 0.15);
  });

  it("only sells regulars an anchor at a price that covers its own cost", () => {
    const regular = { p0: 0.95, segment: "likely_regular" as const, visitCount: 12, avgVisitGpCents: 3500, avgVisitSpendCents: 5800 };
    const best = evaluateDeals({ basket, catalog, programs: [program()], customer: regular, baseline, settings }).best;
    assert.ok(best);
    assert.ok(best.priceCents > best.coveredCostCents, "regulars must not be subsidised");
  });

  it("blocks anchors that would pay for most of the next visit", () => {
    const tightCap = parseSettings({ guardrails: { anchorValueCapRate: 0.2 } });
    const result = evaluateDeals({ basket, catalog, programs: [program()], customer: null, baseline, settings: tightCap });
    assert.equal(result.best, null);
    assert.ok(result.candidates[0]!.reasons.includes("Anchor would cover too much of the next visit"));
  });

  it("supports the beer example: 2 pints kept for next time", () => {
    const beerProgram = program({
      id: "p-beer",
      name: "Beer locker — keep 2 pints",
      unitLabel: "Pint",
      unitLabelPlural: "Pints",
      unitsGranted: 2,
      coverage: { kind: "items", itemIds: ["pint"] },
      trigger: { requiredCategoryCounts: { beer: 4 } },
      pricing: { minPriceRate: 0.3, maxPriceRate: 0.6 },
    });
    const beerBasket: Basket = {
      partySize: 2,
      lines: [
        { itemId: "pint", category: "beer", quantity: 4, unitPriceCents: 1200, unitCostCents: 300 },
        { itemId: "wings", category: "food", quantity: 1, unitPriceCents: 1600, unitCostCents: 450 },
      ],
    };
    const result = evaluateDeals({
      basket: beerBasket,
      catalog,
      programs: [beerProgram],
      customer: null,
      baseline: { avgVisitGpCents: 4000, avgVisitSpendCents: 6400 },
      settings,
    });
    assert.ok(result.best);
    assert.equal(result.best.pitch.label, "2 Pints Remaining");
    assert.equal(result.best.coveredRetailCents, 2400);
  });

  it("prefers the measured lift over the prior when supplied", () => {
    const withMeasured = evaluateDeals({ basket, catalog, programs: [program()], customer: null, baseline, settings, measuredUplift: 0.02 });
    const candidate = withMeasured.candidates[0]!;
    assert.equal(candidate.upliftSource, "measured");
    assert.equal(candidate.uplift, 0.02);
  });

  it("ignores paused programs and stored-purchase programs", () => {
    const result = evaluateDeals({
      basket,
      catalog,
      programs: [program({ status: "paused" }), program({ id: "keep", issueMode: "stored_purchase" })],
      customer: null,
      baseline,
      settings,
    });
    assert.equal(result.candidates.length, 0);
  });
});
