import type { GuardrailRule } from "../types";
import { fail, pass, skip, within } from "./helpers";

/** Do not offer discounts every visit. */
export const discountFrequency: GuardrailRule = {
  key: "discount-frequency",
  label: "Discount frequency",
  description: "At most one discount-type offer per customer within the minimum gap.",
  critical: false,
  appliesTo: ["checkout_offer", "message_offer"],
  check(input, settings) {
    if (!input.offer?.isDiscount) return skip("Not a discount");
    const days = settings.guardrails.discountMinGapDays;
    return within(input.history, input.now, days).some((e) => e.isDiscount)
      ? fail(`A discount was offered within the last ${days} days`)
      : pass();
  },
};
