/**
 * Message timing (pure). Messages are triggered by behaviour and sent at a sensible local
 * hour; the send-time policy (guardrails) still has the final say at dispatch.
 */
import { addDays, localParts, nextLocalTime, startOfLocalDay } from "@/core/time";
import type { MerchantSettings } from "../merchants/settings";

type Messaging = MerchantSettings["messaging"];

/** Typical gap assumed for customers without enough history. */
export const DEFAULT_GAP_DAYS = 21;

/**
 * First reminder: clamp(typicalGap × reminderFraction, min, max) days after issue, moved
 * to the day before the customer's preferred weekday (when known) at the send hour.
 */
export function firstReminderAt(
  issuedAt: Date,
  typicalGapDays: number | null,
  preferredWeekday: number | null,
  s: Messaging,
  timeZone: string,
): Date {
  const gap = typicalGapDays ?? DEFAULT_GAP_DAYS;
  const days = Math.min(s.reminderMaxDays, Math.max(s.reminderMinDays, Math.round(gap * s.reminderFraction)));
  let target = addDays(issuedAt, days);
  if (preferredWeekday !== null) {
    const dayBefore = (preferredWeekday + 6) % 7;
    const start = startOfLocalDay(target, timeZone);
    const aligned = nextLocalTime(start, timeZone, s.sendHour, 0, dayBefore);
    // Only move forward by up to a week; never before the minimum.
    if (aligned.getTime() - target.getTime() <= 7 * 86_400_000) target = aligned;
    return target;
  }
  return nextLocalTime(startOfLocalDay(target, timeZone), timeZone, s.sendHour);
}

/** Expiry warning `expiryWarningDays` before expiry, at the send hour. Null if already past. */
export function expiryWarningAt(expiresAt: Date | null, now: Date, s: Messaging, timeZone: string): Date | null {
  if (!expiresAt) return null;
  const day = startOfLocalDay(addDays(expiresAt, -s.expiryWarningDays), timeZone);
  const at = nextLocalTime(day, timeZone, s.sendHour);
  if (at.getTime() >= expiresAt.getTime()) return null;
  return at.getTime() < now.getTime() ? null : at;
}

/** Win-back is due once the customer has been away `winBackAfterDays` with an active anchor. */
export function winBackDue(lastVisitAt: Date | null, issuedAt: Date, now: Date, s: Messaging): boolean {
  const since = Math.max(lastVisitAt?.getTime() ?? 0, issuedAt.getTime());
  return now.getTime() - since >= s.winBackAfterDays * 86_400_000;
}

/** Next send-hour slot at or after `from` (used for nudges triggered during service). */
export function nextSendSlot(from: Date, s: Messaging, timeZone: string): Date {
  const local = localParts(from, timeZone);
  if (local.hour < s.sendHour) return nextLocalTime(from, timeZone, s.sendHour);
  // Later today is fine for nudges triggered after the send hour, unless it's nearly night.
  return from;
}
