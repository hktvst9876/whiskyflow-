import type { GuardrailRule } from "../types";
import { DAY_MS, pass, skip } from "./helpers";

export const messageFrequencyCap: GuardrailRule = {
  key: "message-frequency-cap",
  label: "Marketing frequency cap",
  description: "Caps marketing messages per customer per 7 and 30 days; a capped message waits for room instead of being dropped. Service messages are not capped.",
  critical: false,
  appliesTo: ["message"],
  check(input, settings) {
    const m = input.message;
    if (!m || m.category !== "marketing") return skip("Not marketing");
    const s = settings.messaging;
    // Defer a day at a time: one-off messages (a win-back) must not be lost to a busy week.
    const retry = new Date(input.now.getTime() + DAY_MS);
    if (m.recipient.marketingSent7 >= s.maxMarketingPer7Days) return { passed: false, reason: "Weekly marketing cap reached", deferUntil: retry };
    if (m.recipient.marketingSent30 >= s.maxMarketingPer30Days) return { passed: false, reason: "Monthly marketing cap reached", deferUntil: retry };
    return pass();
  },
};
