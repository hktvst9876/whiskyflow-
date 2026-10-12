import type { GuardrailRule } from "../types";
import { fail, pass, skip, within } from "./helpers";

export const priceSensitiveFrequency: GuardrailRule = {
  key: "price-sensitive-frequency",
  label: "Price-sensitive frequency cap",
  description: "Price-sensitive customers receive a limited number of offers per window, so deals never become the norm.",
  critical: false,
  appliesTo: ["checkout_offer", "message_offer"],
  check(input, settings) {
    if (input.customer?.segment !== "price_sensitive") return skip("Not price sensitive");
    const g = settings.guardrails;
    const count = within(input.history, input.now, g.priceSensitiveWindowDays).length;
    return count < g.priceSensitiveMaxOffers ? pass() : fail(`${count} offers in the last ${g.priceSensitiveWindowDays} days`);
  },
};
