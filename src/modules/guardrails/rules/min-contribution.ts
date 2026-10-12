import type { GuardrailRule } from "../types";
import { fail, pass, skip } from "./helpers";

export const minContribution: GuardrailRule = {
  key: "min-contribution",
  label: "Minimum expected contribution",
  description: "The offer's expected incremental contribution must clear the merchant's minimum.",
  critical: true,
  appliesTo: ["checkout_offer"],
  check(input, settings) {
    const deal = input.offer?.deal;
    if (!deal) return skip();
    const min = settings.guardrails.minExpectedContributionCents;
    return deal.deltaECents >= min ? pass() : fail(`Expected contribution ${deal.deltaECents}¢ is below ${min}¢`);
  },
};
