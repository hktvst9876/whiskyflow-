/**
 * Segmentation (first match wins, in this priority order):
 * high_value → likely_regular → price_sensitive → at_risk → persuadable → new → occasional.
 */
import { DEFAULT_TYPICAL_GAP_DAYS, SEGMENT_RULES } from "./config";
import type { Segment, ScoreFeatures } from "./types";

export function segmentFor(features: ScoreFeatures, probability: number, winBackAfterDays = 30): Segment {
  const r = SEGMENT_RULES;
  const gap = Math.max(3, features.typicalGapDays ?? DEFAULT_TYPICAL_GAP_DAYS);
  const recencyRatio = features.daysSinceLastVisit === null ? 0 : features.daysSinceLastVisit / gap;

  if (
    features.visitCount >= 2 &&
    (features.spendPercentile >= r.highValueSpendPercentile ||
      (features.avgPartySize >= r.highValueGroupSize && features.spendPercentile >= r.highValueGroupSpendPercentile))
  ) {
    return "high_value";
  }
  if (features.visits90 >= r.likelyRegularVisits90 && probability >= r.likelyRegularProbability) return "likely_regular";
  if (features.visitCount >= r.priceSensitiveMinVisits && features.promoShare >= r.priceSensitivePromoShare) {
    return "price_sensitive";
  }
  const hasAnchor = features.activeEntitlementValueCents > 0;
  const lapsed = (features.daysSinceLastVisit ?? 0) >= winBackAfterDays;
  if (features.visitCount >= 1 && ((hasAnchor && (recencyRatio >= r.atRiskRecencyRatio || lapsed)) || (features.visitCount >= 2 && probability < r.atRiskProbability))) {
    return "at_risk";
  }
  if (features.visitCount >= 2 && probability >= r.persuadableMin && probability < r.persuadableMax) return "persuadable";
  if (features.visitCount <= 1) return "new";
  return "occasional";
}

export const SEGMENT_LABELS: Record<Segment, string> = {
  high_value: "High value",
  likely_regular: "Likely regular",
  price_sensitive: "Price sensitive",
  at_risk: "At risk",
  persuadable: "Persuadable",
  new: "New",
  occasional: "Occasional",
};
