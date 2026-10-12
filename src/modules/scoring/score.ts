/**
 * Return Score: p = sigmoid(b0 + Σ wᵢ·fᵢ). Pure. Weights live in `config.ts`.
 *
 * The deal engine needs the score WITHOUT any anchor (`baselineFeatures`) so it can
 * estimate how much an anchor would change the probability, not double count it.
 */
import { BAND_THRESHOLDS, DEFAULT_TYPICAL_GAP_DAYS, SCORE_WEIGHTS } from "./config";
import type { ReturnBand, ReturnScore, ScoreFactor, ScoreFeatures } from "./types";

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function logit(p: number): number {
  const q = Math.min(0.9999, Math.max(0.0001, p));
  return Math.log(q / (1 - q));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type FeatureKey = Exclude<keyof typeof SCORE_WEIGHTS, "intercept">;

/** Transform raw features into model inputs. */
export function modelInputs(f: ScoreFeatures): Record<FeatureKey, number> {
  const gap = Math.max(3, f.typicalGapDays ?? DEFAULT_TYPICAL_GAP_DAYS);
  const recency = f.daysSinceLastVisit === null ? 0 : clamp(f.daysSinceLastVisit / gap, 0, 4);
  const urgency =
    f.daysToNearestExpiry !== null && f.daysToNearestExpiry <= 21 && f.daysToNearestExpiry >= 0
      ? 1 - f.daysToNearestExpiry / 21
      : 0;
  return {
    recencyRatio: recency,
    visits90: Math.min(f.visits90, 10),
    totalVisitsLog: Math.log(1 + Math.max(0, f.visitCount)),
    tenureYears: clamp(f.tenureDays / 365, 0, 2),
    spendPercentile: clamp(f.spendPercentile, 0, 1) - 0.5,
    partySize: clamp(f.avgPartySize || 2, 1, 8) - 2,
    anchorValueLog: Math.log(1 + Math.max(0, f.activeEntitlementValueCents) / 1000),
    expiryUrgency: f.activeEntitlementValueCents > 0 ? urgency : 0,
    messageResponse: (f.messageResponseRate ?? 0.3) - 0.3,
  };
}

const FACTOR_LABELS: Record<FeatureKey, (f: ScoreFeatures, contribution: number) => string> = {
  recencyRatio: (f) =>
    f.daysSinceLastVisit === null
      ? "No visit yet"
      : `Last visit ${Math.round(f.daysSinceLastVisit)} days ago (usual gap ${Math.round(f.typicalGapDays ?? DEFAULT_TYPICAL_GAP_DAYS)})`,
  visits90: (f) => `${f.visits90} visit${f.visits90 === 1 ? "" : "s"} in the last 90 days`,
  totalVisitsLog: (f) => `${f.visitCount} visit${f.visitCount === 1 ? "" : "s"} in total`,
  tenureYears: (f) => `Customer for ${Math.round(f.tenureDays)} days`,
  spendPercentile: (f, c) => (c >= 0 ? `Spends more than ${Math.round(f.spendPercentile * 100)}% of customers` : "Below-average spend"),
  partySize: (f) => `Usually a party of ${Math.round(f.avgPartySize || 1)}`,
  anchorValueLog: () => "Has something waiting here",
  expiryUrgency: (f) => `Anchor expires in ${Math.round(f.daysToNearestExpiry ?? 0)} days`,
  messageResponse: (f) => `Responds to ${Math.round((f.messageResponseRate ?? 0) * 100)}% of reminders`,
};

export function bandFor(probability: number): ReturnBand {
  if (probability >= BAND_THRESHOLDS.high) return "high";
  if (probability >= BAND_THRESHOLDS.medium) return "medium";
  return "at_risk";
}

/** Compute the Return Score and its top explaining factors. */
export function computeReturnScore(features: ScoreFeatures, weights = SCORE_WEIGHTS): ReturnScore {
  const inputs = modelInputs(features);
  let z = weights.intercept;
  const factors: ScoreFactor[] = [];
  for (const key of Object.keys(inputs) as FeatureKey[]) {
    const contribution = weights[key] * inputs[key];
    z += contribution;
    if (Math.abs(contribution) >= 0.05) {
      factors.push({ key, label: FACTOR_LABELS[key](features, contribution), contribution: Math.round(contribution * 100) / 100 });
    }
  }
  const probability = sigmoid(z);
  factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { probability, score: Math.round(probability * 100), band: bandFor(probability), factors: factors.slice(0, 5) };
}

/** The same customer with no entitlements: the baseline p0 used by the deal engine. */
export function baselineFeatures(features: ScoreFeatures): ScoreFeatures {
  return { ...features, activeEntitlementValueCents: 0, daysToNearestExpiry: null };
}

/** Percentile rank of `value` within `sorted` (ascending), 0-1. */
export function percentileRank(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return 0.5;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  let equalEnd = lo;
  while (equalEnd < sorted.length && sorted[equalEnd] === value) equalEnd++;
  // Mid-rank for ties.
  return (lo + equalEnd) / 2 / sorted.length;
}
