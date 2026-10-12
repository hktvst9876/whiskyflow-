/**
 * Return Score model weights. A hand-set logistic prior, documented so it can be refitted
 * per merchant once enough history exists (Phase 2). Each weight multiplies a feature
 * defined in `score.ts`; positive weights raise the probability of returning.
 */
export const SCORE_WEIGHTS = {
  // Intercept: a one-visit customer with no anchor lands near 28%.
  intercept: -1.6,
  // Days since last visit ÷ typical gap (capped at 4). Overdue customers drift away.
  recencyRatio: -0.9,
  // Visits in the last 90 days (capped at 10).
  visits90: 0.35,
  // ln(1 + lifetime visits).
  totalVisitsLog: 0.45,
  // Years as a customer (capped at 2).
  tenureYears: 0.15,
  // Spend percentile − 0.5.
  spendPercentile: 0.4,
  // Average party size − 2 (capped at 8 people).
  partySize: 0.05,
  // ln(1 + remaining entitlement value in $10 units). Owning something brings people back.
  anchorValueLog: 0.6,
  // Expiry urgency in the last 21 days before expiry (0-1).
  expiryUrgency: 0.3,
  // Message response rate − 0.3 (neutral when never messaged).
  messageResponse: 1.2,
} as const;

/** Typical gap used when a customer has fewer than two visits. */
export const DEFAULT_TYPICAL_GAP_DAYS = 21;

export const BAND_THRESHOLDS = { high: 0.6, medium: 0.3 } as const;

/** Segmentation thresholds. */
export const SEGMENT_RULES = {
  highValueSpendPercentile: 0.8,
  highValueGroupSize: 4,
  highValueGroupSpendPercentile: 0.6,
  likelyRegularVisits90: 3,
  likelyRegularProbability: 0.6,
  priceSensitivePromoShare: 0.5,
  priceSensitiveMinVisits: 3,
  atRiskRecencyRatio: 1.5,
  atRiskProbability: 0.3,
  persuadableMin: 0.3,
  persuadableMax: 0.6,
} as const;

/** Rescore customers whose score is older than this. */
export const RESCORE_AFTER_HOURS = 20;
