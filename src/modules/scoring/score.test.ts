import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextRecommendedAction } from "./playbooks";
import { baselineFeatures, computeReturnScore, percentileRank } from "./score";
import { segmentFor } from "./segments";
import type { ScoreFeatures } from "./types";

const base: ScoreFeatures = {
  visitCount: 1,
  visits90: 1,
  daysSinceLastVisit: 0,
  typicalGapDays: null,
  tenureDays: 0,
  spendPercentile: 0.5,
  avgPartySize: 2,
  activeEntitlementValueCents: 0,
  daysToNearestExpiry: null,
  messageResponseRate: null,
  promoShare: 0,
};

describe("computeReturnScore", () => {
  it("puts a first-time customer around a quarter to a third", () => {
    const s = computeReturnScore(base);
    assert.ok(s.probability > 0.2 && s.probability < 0.35, String(s.probability));
    assert.equal(s.band, "at_risk");
  });

  it("scores a frequent regular high", () => {
    const s = computeReturnScore({ ...base, visitCount: 12, visits90: 6, daysSinceLastVisit: 5, typicalGapDays: 12, tenureDays: 200, spendPercentile: 0.7 });
    assert.equal(s.band, "high");
    assert.ok(s.factors.length > 0);
  });

  it("raises the probability when the customer owns something here (and baselineFeatures removes it)", () => {
    const owning = { ...base, activeEntitlementValueCents: 2400, daysToNearestExpiry: 10 };
    const withAnchor = computeReturnScore(owning).probability;
    const without = computeReturnScore(baselineFeatures(owning)).probability;
    assert.ok(withAnchor > without);
    assert.equal(without, computeReturnScore(base).probability);
  });

  it("drops as the customer becomes overdue", () => {
    const fresh = computeReturnScore({ ...base, visitCount: 4, visits90: 3, daysSinceLastVisit: 5, typicalGapDays: 14 }).probability;
    const overdue = computeReturnScore({ ...base, visitCount: 4, visits90: 1, daysSinceLastVisit: 50, typicalGapDays: 14 }).probability;
    assert.ok(overdue < fresh);
  });
});

describe("segmentFor", () => {
  it("follows the priority order", () => {
    assert.equal(segmentFor({ ...base, visitCount: 3, spendPercentile: 0.9 }, 0.5), "high_value");
    assert.equal(segmentFor({ ...base, visitCount: 6, visits90: 4 }, 0.7), "likely_regular");
    assert.equal(segmentFor({ ...base, visitCount: 4, promoShare: 0.75 }, 0.4), "price_sensitive");
    assert.equal(segmentFor({ ...base, visitCount: 2, activeEntitlementValueCents: 2400, daysSinceLastVisit: 40 }, 0.35), "at_risk");
    assert.equal(segmentFor({ ...base, visitCount: 3 }, 0.45), "persuadable");
    assert.equal(segmentFor(base, 0.28), "new");
  });
});

describe("percentileRank", () => {
  it("uses mid-ranks for ties", () => {
    assert.equal(percentileRank([1, 2, 3, 4], 5), 1);
    assert.equal(percentileRank([1, 2, 3, 4], 0), 0);
    assert.equal(percentileRank([2, 2, 2, 2], 2), 0.5);
  });
});

describe("nextRecommendedAction", () => {
  const now = new Date("2026-10-12T10:00:00Z");
  it("prioritises an imminent expiry", () => {
    const action = nextRecommendedAction({
      now,
      segment: "likely_regular",
      anchors: [{ label: "1 Main Waiting", status: "active", expiresAt: new Date(now.getTime() + 3 * 86_400_000) }],
      lastOfferAt: null,
      offerCooldownDays: 14,
      expiryWarningDays: 7,
    });
    assert.equal(action.key, "expiry_reminder");
  });

  it("recommends recognition, not discounts, for likely regulars", () => {
    const action = nextRecommendedAction({ now, segment: "likely_regular", anchors: [], lastOfferAt: null, offerCooldownDays: 14, expiryWarningDays: 7 });
    assert.equal(action.key, "recognise");
  });
});
