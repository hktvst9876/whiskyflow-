import type { GuardrailRule } from "../types";
import { fail, pass, skip } from "./helpers";

export const maxDiscountDepth: GuardrailRule = {
  key: "max-discount-depth",
  label: "Maximum implied discount",
  description: "The upgrade price cannot imply a discount deeper than the merchant's maximum.",
  critical: false,
  appliesTo: ["checkout_offer"],
  check(input, settings) {
    const deal = input.offer?.deal;
    if (!deal) return skip();
    const max = settings.guardrails.maxImpliedDiscountRate;
    return deal.depth <= max + 1e-9
      ? pass()
      : fail(`Implied discount ${(deal.depth * 100).toFixed(0)}% exceeds ${(max * 100).toFixed(0)}%`);
  },
};
