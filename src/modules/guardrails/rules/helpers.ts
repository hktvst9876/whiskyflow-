/** Shared helpers for guardrail rules. */
import type { ExposureFact } from "../../offers/types";
import type { RuleOutcome } from "../types";

export const DAY_MS = 86_400_000;

export const pass = (reason = "OK"): RuleOutcome => ({ passed: true, reason });
export const fail = (reason: string): RuleOutcome => ({ passed: false, reason });
export const skip = (reason = "Not applicable"): RuleOutcome => ({ passed: true, reason, skipped: true });

/** Exposures shown in the last `days` (declined/expired still count — they were offered). */
export function within(history: ExposureFact[] | undefined, now: Date, days: number): ExposureFact[] {
  if (!history) return [];
  const from = now.getTime() - days * DAY_MS;
  return history.filter((e) => e.shownAt.getTime() >= from && e.shownAt.getTime() <= now.getTime());
}

/** Promotional = costs the merchant something or is a discount. Paid anchors are not. */
export function isPromotional(e: { isDiscount: boolean; promoCostCents: number }): boolean {
  return e.isDiscount || e.promoCostCents > 0;
}
