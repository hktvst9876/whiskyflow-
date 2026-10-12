import type { GuardrailRule } from "../types";
import { fail, pass, skip } from "./helpers";

export const liabilityCap: GuardrailRule = {
  key: "liability-cap",
  label: "Outstanding liability cap",
  description: "The retail value of all unredeemed anchors stays under the merchant's cap.",
  critical: true,
  appliesTo: ["checkout_offer"],
  check(input, settings) {
    if (!input.merchant) return skip();
    const cap = settings.guardrails.liabilityCapCents;
    const after = input.merchant.outstandingLiabilityCents + input.merchant.addedLiabilityCents;
    return after <= cap ? pass() : fail("Outstanding anchor liability would exceed the cap");
  },
};
