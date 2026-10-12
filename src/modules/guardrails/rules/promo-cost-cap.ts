import type { GuardrailRule } from "../types";
import { fail, pass, skip, within } from "./helpers";

export const promoCostCap: GuardrailRule = {
  key: "promo-cost-cap",
  label: "Promotional cost cap",
  description: "Total promotional cost per customer within the window stays under the cap.",
  critical: false,
  appliesTo: ["checkout_offer", "message_offer"],
  check(input, settings) {
    if (!input.offer || input.offer.promoCostCents <= 0) return skip("No promotional cost");
    const g = settings.guardrails;
    const spent = within(input.history, input.now, g.promoCostWindowDays)
      .filter((e) => e.status === "redeemed" || e.status === "accepted" || e.status === "shown")
      .reduce((s, e) => s + e.promoCostCents, 0);
    return spent + input.offer.promoCostCents <= g.promoCostCapCents
      ? pass()
      : fail(`Would exceed the ${g.promoCostWindowDays}-day promotional budget for this customer`);
  },
};
