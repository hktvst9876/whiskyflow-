import type { GuardrailRule } from "../types";
import { fail, pass, skip } from "./helpers";

export const blackoutPeriod: GuardrailRule = {
  key: "blackout-period",
  label: "Blackout period",
  description: "No new offers on the merchant's blackout dates.",
  critical: false,
  appliesTo: ["checkout_offer", "message_offer"],
  check(input) {
    if (!input.merchant) return skip();
    return input.merchant.blackoutReason ? fail(`Blackout: ${input.merchant.blackoutReason}`) : pass();
  },
};
