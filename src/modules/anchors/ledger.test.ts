import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coverageText, entitlementLabel } from "./labels";
import { applyAdjust, applyLevel, applyRedeem, applyVoid, checkRedemptionRules, redemptionCostCents, refundAllowed } from "./ledger";
import { buildTermsSnapshot, transparencyLines } from "./terms";

const now = new Date("2026-10-12T06:00:00Z"); // Monday 14:00 SGT
const item = { status: "active" as const, unitType: "item" as const, quantityRemaining: 2, quantityInitial: 2, expiresAt: null };
const bottle = { status: "active" as const, unitType: "percent" as const, quantityRemaining: 70, quantityInitial: 100, expiresAt: null };

describe("labels", () => {
  it("speaks in owned things, not credit", () => {
    assert.equal(entitlementLabel({ unitType: "item", quantityRemaining: 1, unitLabel: "Main", unitLabelPlural: "Mains", displayName: "Main" }), "1 Main Waiting");
    assert.equal(entitlementLabel({ unitType: "item", quantityRemaining: 3, unitLabel: "pint", unitLabelPlural: "pints", displayName: "Pint" }), "3 Pints Remaining");
    assert.equal(entitlementLabel({ unitType: "session", quantityRemaining: 2, unitLabel: "Massage", unitLabelPlural: "Massages", displayName: "60-min Massage" }), "2 Massages Remaining");
    assert.equal(entitlementLabel({ unitType: "percent", quantityRemaining: 42, unitLabel: "Bottle", unitLabelPlural: "Bottles", displayName: "Macallan 12" }), "Macallan 12 · 42% remaining");
  });

  it("describes coverage plainly", () => {
    assert.equal(coverageText({ kind: "category", category: "main", maxCoveredPriceCents: 2400 }, { unitLabel: "Main" }), "any main up to $24");
    assert.equal(coverageText({ kind: "items", itemIds: ["a", "b"] }, { unitLabel: "Pint", itemNames: { a: "Lager", b: "IPA" } }), "Lager or IPA");
  });
});

describe("ledger", () => {
  it("redeems units and completes at zero", () => {
    const first = applyRedeem(item, 1, now);
    assert.deepEqual([first.quantityAfter, first.statusAfter, first.event.quantityDelta], [1, "active", -1]);
    const last = applyRedeem({ ...item, quantityRemaining: 1 }, 1, now);
    assert.equal(last.statusAfter, "fully_redeemed");
  });

  it("never lets the balance go negative or redeem expired/pending anchors", () => {
    assert.throws(() => applyRedeem(item, 3, now), /Only 2 left/);
    assert.throws(() => applyRedeem({ ...item, expiresAt: new Date(now.getTime() - 1) }, 1, now), /expired/);
    assert.throws(() => applyRedeem({ ...item, status: "pending_claim" }, 1, now), /not been claimed/);
  });

  it("records bottle levels downward only", () => {
    const change = applyLevel(bottle, 42, now);
    assert.deepEqual([change.quantityAfter, change.event.quantityDelta, change.event.type], [42, -28, "level_recorded"]);
    assert.throws(() => applyLevel(bottle, 80, now), /cannot go up/);
  });

  it("requires a reason for adjustments and voids, within bounds", () => {
    assert.throws(() => applyAdjust(item, -1, " "), /reason/);
    assert.throws(() => applyAdjust(item, 1, "goodwill"), /exceed/);
    assert.equal(applyAdjust(item, -1, "spilled").quantityAfter, 1);
    assert.equal(applyVoid(item, "duplicate").statusAfter, "voided");
  });

  it("recognises cost only for upgrade anchors (stored purchases were expensed at sale)", () => {
    assert.equal(redemptionCostCents({ issueMode: "upgrade_offer", unitType: "item", unitCostCents: 800 }, 1), 800);
    assert.equal(redemptionCostCents({ issueMode: "stored_purchase", unitType: "percent", unitCostCents: 9000 }, 30), 0);
    assert.equal(redemptionCostCents({ issueMode: "upgrade_offer", unitType: "percent", unitCostCents: 9000 }, 30), 2700);
  });

  it("enforces weekday and off-peak redemption rules in the merchant's zone", () => {
    const offPeak = [{ weekdays: [1, 2, 3, 4], start: "14:00", end: "18:00" }];
    assert.equal(checkRedemptionRules({ allowedWeekdays: [1, 2, 3, 4] }, now, "Asia/Singapore", offPeak).ok, true);
    assert.equal(checkRedemptionRules({ allowedWeekdays: [5, 6] }, now, "Asia/Singapore", offPeak).ok, false);
    assert.equal(checkRedemptionRules({ offPeakOnly: true }, now, "Asia/Singapore", offPeak).ok, true);
    const evening = new Date("2026-10-12T12:00:00Z"); // 20:00 SGT
    assert.equal(checkRedemptionRules({ offPeakOnly: true }, evening, "Asia/Singapore", offPeak).ok, false);
  });

  it("applies the refund policy to unused anchors only", () => {
    const created = new Date(now.getTime() - 20 * 86_400_000);
    assert.equal(refundAllowed({ quantityRemaining: 1, quantityInitial: 1, createdAt: created, refundPolicy: "unused_within_14_days" }, now).ok, false);
    assert.equal(refundAllowed({ quantityRemaining: 1, quantityInitial: 1, createdAt: created, refundPolicy: "unused_any_time" }, now).ok, true);
    assert.equal(refundAllowed({ quantityRemaining: 0, quantityInitial: 1, createdAt: now, refundPolicy: "unused_any_time" }, now).ok, false);
  });
});

describe("transparency", () => {
  it("lists what the customer owns, rules and refunds in plain words", () => {
    const snapshot = buildTermsSnapshot({
      programName: "3-Main Set",
      coverageText: "any main up to $24",
      expiresAt: new Date("2026-12-11T15:59:00Z"),
      redemption: { allowedWeekdays: [1, 2, 3, 4], requiresNewPurchase: true },
      transferable: false,
      refundPolicy: "unused_within_14_days",
      upgradeAllowed: true,
      terms: "",
      pricePaidCents: 900,
      currency: "SGD",
      issuedAt: now,
    });
    const lines = Object.fromEntries(transparencyLines(snapshot).map((l) => [l.label, l.value]));
    assert.equal(lines.Covers, "any main up to $24");
    assert.equal(lines.Paid, "$9.00");
    assert.match(lines.When!, /Mon, Tue, Wed, Thu only; with any new purchase/);
    assert.match(lines.Refunds!, /14 days/);
    assert.match(lines.Sharing!, /not transferable/);
  });
});
