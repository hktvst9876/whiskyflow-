import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAggregates } from "../customers/aggregates";
import { computeTotals } from "./totals";

describe("computeTotals", () => {
  it("separates new cash, anchor upgrades, redemptions, perks and discounts", () => {
    const t = computeTotals([
      { lineType: "regular", quantity: 2, unitPriceCents: 2200, unitCostCents: 700, voidedAt: null },
      { lineType: "anchor_upgrade", quantity: 1, unitPriceCents: 900, unitCostCents: 0, voidedAt: null },
      { lineType: "anchor_redemption", quantity: 1, unitPriceCents: 0, unitCostCents: 800, voidedAt: null },
      { lineType: "perk", quantity: 1, unitPriceCents: 0, unitCostCents: 150, voidedAt: null },
      { lineType: "discount", quantity: 1, unitPriceCents: -300, unitCostCents: 0, voidedAt: null },
      { lineType: "regular", quantity: 1, unitPriceCents: 9999, unitCostCents: 1, voidedAt: new Date() },
    ]);
    assert.equal(t.newCashRevenueCents, 4400);
    assert.equal(t.newCashGpCents, 3000);
    assert.equal(t.anchorUpgradeRevenueCents, 900);
    assert.equal(t.redemptionCostCents, 800);
    assert.equal(t.perkCostCents, 150);
    assert.equal(t.discountCents, 300);
    assert.equal(t.revenueCents, 4400 + 900 - 300);
    assert.equal(t.gpCents, 5000 - (1400 + 800 + 150));
    assert.equal(t.isRedemptionVisit, true);
    assert.equal(t.itemCount, 2);
  });
});

describe("computeAggregates", () => {
  it("derives habits: preferred weekday/hour and the typical gap", () => {
    // Saturdays 19:00 SGT, two weeks apart.
    const visits = ["2026-09-05T11:00:00Z", "2026-09-19T11:00:00Z", "2026-10-03T11:00:00Z"].map((iso, i) => ({
      openedAt: new Date(iso),
      partySize: 2 + i,
      spendCents: 5000,
      gpCents: 3000,
      promo: i === 0,
    }));
    const a = computeAggregates(visits, "Asia/Singapore");
    assert.equal(a.visitCount, 3);
    assert.equal(a.preferredWeekday, 6);
    assert.equal(a.preferredHour, 19);
    assert.equal(a.typicalGapDays, 14);
    assert.equal(a.avgPartySize, 3);
    assert.equal(a.promoVisitCount, 1);
    assert.equal(a.totalGpCents, 9000);
  });

  it("does not invent habits from a single visit", () => {
    const a = computeAggregates([{ openedAt: new Date(), partySize: 2, spendCents: 100, gpCents: 50, promo: false }], "Asia/Singapore");
    assert.equal(a.preferredWeekday, null);
    assert.equal(a.typicalGapDays, null);
  });
});
