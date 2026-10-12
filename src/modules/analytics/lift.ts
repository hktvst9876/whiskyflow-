/**
 * Causal lift from the randomised holdout (pure).
 *
 * Unit of analysis: a customer identified at assignment, assigned at least `horizonDays`
 * ago. Outcome: contribution over the horizon = GP of their visits from the assignment
 * visit onwards − promotional cost − cost of anchors still outstanding at the horizon.
 * Estimate: difference in means (treatment − holdout) with a Welch standard error and a
 * 90% confidence interval. This answers "did the intervention make customers more
 * valuable than they would have been without it?" — not "how many redeemed?".
 */
import type { AssignmentOutcome, LiftEstimate } from "../experiments/types";

const Z90 = 1.6449;

function meanVar(values: number[]): { mean: number; variance: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, variance: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n === 1) return { mean, variance: 0 };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return { mean, variance };
}

export function estimateLift(outcomes: AssignmentOutcome[], minPerArm = 30): LiftEstimate {
  const t = outcomes.filter((o) => o.arm === "treatment");
  const h = outcomes.filter((o) => o.arm === "holdout");
  const tc = meanVar(t.map((o) => o.contributionCents));
  const hc = meanVar(h.map((o) => o.contributionCents));
  const tReturn = t.length ? t.filter((o) => o.returnVisits > 0).length / t.length : 0;
  const hReturn = h.length ? h.filter((o) => o.returnVisits > 0).length / h.length : 0;
  const diff = tc.mean - hc.mean;
  const se = t.length > 0 && h.length > 0 ? Math.sqrt(tc.variance / t.length + hc.variance / h.length) : 0;
  const low = diff - Z90 * se;
  const high = diff + Z90 * se;

  let verdict: LiftEstimate["verdict"];
  if (t.length < minPerArm || h.length < minPerArm) verdict = "insufficient_data";
  else if (low > 0) verdict = "positive";
  else if (high < 0) verdict = "negative";
  else verdict = "inconclusive";

  return {
    treatmentN: t.length,
    holdoutN: h.length,
    treatmentMeanCents: Math.round(tc.mean),
    holdoutMeanCents: Math.round(hc.mean),
    diffCents: Math.round(diff),
    standardErrorCents: Math.round(se),
    ci90LowCents: Math.round(low),
    ci90HighCents: Math.round(high),
    treatmentReturnRate: tReturn,
    holdoutReturnRate: hReturn,
    returnRateLift: tReturn - hReturn,
    verdict,
  };
}

/**
 * Measured uplift in return probability for the deal engine, or null when the evidence
 * is too thin. Shrunk toward zero by sample size so a lucky early run cannot inflate offers.
 */
export function measuredUplift(estimate: LiftEstimate, minPerArm: number): number | null {
  if (estimate.treatmentN < minPerArm || estimate.holdoutN < minPerArm) return null;
  const n = Math.min(estimate.treatmentN, estimate.holdoutN);
  const shrink = n / (n + minPerArm);
  return Math.max(0, estimate.returnRateLift * shrink);
}

export const VERDICT_TEXT: Record<LiftEstimate["verdict"], string> = {
  insufficient_data: "Not enough matured customers yet to judge.",
  positive: "Customers offered Return Anchors are measurably more valuable than the holdout.",
  negative: "Customers offered Return Anchors are less valuable than the holdout — review pricing and guardrails.",
  inconclusive: "No clear difference yet; the confidence interval includes zero.",
};
