import { isWithinLocalWindow, localParts, parseHHMM, zonedDateTime } from "@/core/time";
import type { GuardrailRule } from "../types";
import { pass, skip } from "./helpers";

/** Messages never arrive at night; due messages wait until quiet hours end. */
export const quietHours: GuardrailRule = {
  key: "quiet-hours",
  label: "Quiet hours",
  description: "No messages during the merchant's quiet hours; they are delayed, not dropped.",
  critical: true,
  appliesTo: ["message"],
  check(input, settings) {
    const m = input.message;
    if (!m || m.category === "service_reply") return skip();
    const { quietHoursStart, quietHoursEnd } = settings.messaging;
    if (!isWithinLocalWindow(input.now, m.timeZone, quietHoursStart, quietHoursEnd)) return pass();
    const local = localParts(input.now, m.timeZone);
    const endMinutes = parseHHMM(quietHoursEnd);
    const nowMinutes = local.hour * 60 + local.minute;
    // Before the end time today → today; otherwise the window ends tomorrow.
    const dayOffset = nowMinutes < endMinutes ? 0 : 1;
    const base = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
    const until = zonedDateTime(
      {
        year: base.getUTCFullYear(),
        month: base.getUTCMonth() + 1,
        day: base.getUTCDate(),
        hour: Math.floor(endMinutes / 60),
        minute: endMinutes % 60,
      },
      m.timeZone,
    );
    return { passed: false, reason: "Quiet hours", deferUntil: until };
  },
};
