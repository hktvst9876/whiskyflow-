import type { GuardrailRule } from "../types";
import { fail, pass, skip } from "./helpers";

/** Avoid subsidising customers who would return anyway. */
export const regularsNoDiscount: GuardrailRule = {
  key: "regulars-no-discount",
  label: "No discounts for regulars",
  description: "Likely regulars and high-value customers get recognition and perks, never discounts.",
  critical: false,
  appliesTo: ["checkout_offer", "message_offer"],
  check(input) {
    if (!input.offer?.isDiscount) return skip("Not a discount");
    const segment = input.customer?.segment;
    return segment === "likely_regular" || segment === "high_value"
      ? fail("Customer is likely to return without a discount")
      : pass();
  },
};
