import type { GuardrailRule } from "../types";
import { fail, pass, skip } from "./helpers";

export const messageFrequencyCap: GuardrailRule = {
  key: "message-frequency-cap",
  label: "Marketing frequency cap",
  description: "Caps marketing messages per customer per 7 and 30 days. Service messages are not capped.",
  critical: false,
  appliesTo: ["message"],
  check(input, settings) {
    const m = input.message;
    if (!m || m.category !== "marketing") return skip("Not marketing");
    const s = settings.messaging;
    if (m.recipient.marketingSent7 >= s.maxMarketingPer7Days) return fail("Weekly marketing cap reached");
    if (m.recipient.marketingSent30 >= s.maxMarketingPer30Days) return fail("Monthly marketing cap reached");
    return pass();
  },
};
