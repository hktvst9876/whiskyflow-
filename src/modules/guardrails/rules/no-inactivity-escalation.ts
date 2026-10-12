import type { GuardrailRule } from "../types";
import { fail, isPromotional, pass, skip } from "./helpers";

/** Waiting longer must never earn a better deal. */
export const noInactivityEscalation: GuardrailRule = {
  key: "no-inactivity-escalation",
  label: "No inactivity escalation",
  description: "Win-back offers are never discounts and never worth more than the customer's previous promotion.",
  critical: false,
  appliesTo: ["message_offer"],
  check(input) {
    if (!input.offer?.isWinBack) return skip("Not a win-back");
    if (input.offer.isDiscount) return fail("Win-backs use perks, not discounts");
    const previous = (input.history ?? []).filter(isPromotional);
    if (previous.length === 0) return pass();
    const maxPrevious = Math.max(...previous.map((e) => e.promoCostCents));
    return input.offer.promoCostCents <= maxPrevious ? pass() : fail("Would be worth more than their last promotion");
  },
};
