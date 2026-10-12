/** Customer aggregates recomputed from visit facts (pure). */
import { daysBetween, localParts } from "@/core/time";
import type { CustomerAggregates, VisitFact } from "./types";

function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Preferred weekday/hour need at least two visits (one visit is not a habit).
 * Typical gap = median days between consecutive visits.
 */
export function computeAggregates(visits: readonly VisitFact[], timeZone: string): CustomerAggregates & { promoVisitCount: number } {
  const sorted = [...visits].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  const n = sorted.length;
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) gaps.push(daysBetween(sorted[i - 1]!.openedAt, sorted[i]!.openedAt));
  const meaningfulGaps = gaps.filter((g) => g >= 0.5);
  const local = sorted.map((v) => localParts(v.openedAt, timeZone));
  const typicalGap = median(meaningfulGaps);
  return {
    firstVisitAt: sorted[0]?.openedAt ?? null,
    lastVisitAt: sorted[n - 1]?.openedAt ?? null,
    visitCount: n,
    totalSpendCents: sorted.reduce((s, v) => s + v.spendCents, 0),
    totalGpCents: sorted.reduce((s, v) => s + v.gpCents, 0),
    avgPartySize: n ? sorted.reduce((s, v) => s + v.partySize, 0) / n : 0,
    preferredWeekday: n >= 2 ? mode(local.map((p) => p.weekday)) : null,
    preferredHour: n >= 2 ? mode(local.map((p) => p.hour)) : null,
    typicalGapDays: typicalGap === null ? null : Math.max(1, Math.round(typicalGap)),
    promoVisitCount: sorted.filter((v) => v.promo).length,
  };
}
