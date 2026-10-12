import type { GuardrailRule } from "../types";
import { fail, isPromotional, pass, skip, within } from "./helpers";

export const priceSensitiveFrequency: GuardrailRule = {
  key: "price-sensitive-frequency",
  label: "Price-sensitive frequency cap",
  description: "Price-sensitive customers receive a limited number of offers per window, so deals never become the norm.",
  critical: false,
  appliesTo: ["checkout_offer", "message_offer"],
  check(input, settings) {
    if (input.customer?.segment !== "price_sensitive") return skip("Not price sensitive");
    // Paid anchors are not deals; only promotions count towards the cap.
    if (!input.offer || !isPromotional(input.offer)) return skip("Not a promotion");
    const g = settings.guardrails;
    const count = within(input.history, input.now, g.priceSensitiveWindowDays).filter(isPromotional).length;
    return count < g.priceSensitiveMaxOffers ? pass() : fail(`${count} offers in the last ${g.priceSensitiveWindowDays} days`);
  },
};
