import type { GuardrailRule } from "../types";
import { fail, isPromotional, pass, skip, within } from "./helpers";

export const cooldownAfterOffer: GuardrailRule = {
  key: "cooldown-after-offer",
  label: "Cooldown after an offer",
  description: "After a promotion is shown, the customer gets no new promotion for the cooldown period.",
  critical: false,
  appliesTo: ["checkout_offer", "message_offer"],
  check(input, settings) {
    if (!input.offer || !isPromotional(input.offer)) return skip("Not a promotion");
    const days = settings.guardrails.offerCooldownDays;
    const recent = within(input.history, input.now, days).filter(isPromotional);
    return recent.length > 0 ? fail(`Promotion shown within the last ${days} days`) : pass();
  },
};
