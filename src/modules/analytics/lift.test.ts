import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignArm } from "../experiments/assign";
import type { AssignmentOutcome } from "../experiments/types";
import { summariseAttribution } from "./attribution";
import { estimateLift, measuredUplift } from "./lift";

describe("assignArm", () => {
  it("is deterministic and close to the requested holdout share", () => {
    let holdout = 0;
    for (let i = 0; i < 5000; i++) {
      const arm = assignArm("salt", "customer", `c-${i}`, 0.2);
      assert.equal(arm, assignArm("salt", "customer", `c-${i}`, 0.2));
      if (arm === "holdout") holdout++;
    }
    assert.ok(holdout > 900 && holdout < 1100, `holdout ${holdout}`);
  });

  it("changes with the salt (independent experiments)", () => {
    const a = Array.from({ length: 200 }, (_, i) => assignArm("a", "visit", `v${i}`, 0.5));
    const b = Array.from({ length: 200 }, (_, i) => assignArm("b", "visit", `v${i}`, 0.5));
    assert.notDeepEqual(a, b);
  });
});

function outcomes(arm: AssignmentOutcome["arm"], n: number, mean: number, spread: number, returnShare: number): AssignmentOutcome[] {
  return Array.from({ length: n }, (_, i) => ({
    arm,
    contributionCents: mean + ((i % 7) - 3) * spread,
    returnVisits: i / n < returnShare ? 1 : 0,
  }));
}

describe("estimateLift", () => {
  it("reports insufficient data below the minimum per arm", () => {
    const e = estimateLift([...outcomes("treatment", 10, 5000, 100, 0.5), ...outcomes("holdout", 3, 3000, 100, 0.3)], 30);
    assert.equal(e.verdict, "insufficient_data");
  });

  it("finds a clear positive lift with a CI that excludes zero", () => {
    const e = estimateLift([...outcomes("treatment", 200, 5200, 300, 0.55), ...outcomes("holdout", 60, 4000, 300, 0.35)], 30);
    assert.equal(e.verdict, "positive");
    assert.ok(Math.abs(e.diffCents - 1200) < 60, String(e.diffCents));
    assert.ok(e.ci90LowCents > 0);
    assert.ok(Math.abs(e.returnRateLift - 0.2) < 0.02);
    const uplift = measuredUplift(e, 30);
    assert.ok(uplift !== null && uplift > 0 && uplift < e.returnRateLift);
  });

  it("calls it inconclusive when the interval spans zero", () => {
    const e = estimateLift([...outcomes("treatment", 40, 4050, 3000, 0.4), ...outcomes("holdout", 40, 4000, 3000, 0.4)], 30);
    assert.equal(e.verdict, "inconclusive");
  });
});

describe("summariseAttribution", () => {
  it("adds up the brief's attributed metrics and keeps promo cost separate", () => {
    const summary = summariseAttribution(
      [
        { visitId: "v1", customerId: "c1", isRedemptionVisit: true, newCashRevenueCents: 3200, newCashCostCents: 1000, anchorUpgradeRevenueCents: 0, redemptionCostCents: 800, redeemedRetailCents: 2400, redemptionCount: 1, perkCostCents: 200, discountCents: 0 },
        { visitId: "v2", customerId: "c2", isRedemptionVisit: false, newCashRevenueCents: 5800, newCashCostCents: 1900, anchorUpgradeRevenueCents: 900, redemptionCostCents: 0, redeemedRetailCents: 0, redemptionCount: 0, perkCostCents: 0, discountCents: 0 },
      ],
      { messageCostCents: 50 },
    );
    assert.equal(summary.redemptions, 1);
    assert.equal(summary.customersReturning, 1);
    assert.equal(summary.storedValueRedeemedCents, 2400);
    assert.equal(summary.newCashDuringRedemptionsCents, 3200);
    assert.equal(summary.grossProfitFromNewCashCents, 2200);
    assert.equal(summary.newPackagesSoldCents, 900);
    assert.equal(summary.totalAttributableRevenueCents, 4100);
    assert.equal(summary.promotionalCostCents, 250);
    assert.equal(summary.attributedContributionCents, 2200 + 900 - 800 - 250);
  });
});
