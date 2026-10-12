import type { GuardrailRule } from "../types";
import { fail, pass, skip } from "./helpers";

/** Leave enough behind to cause the next visit, but room for new spending when they return. */
export const anchorValueCap: GuardrailRule = {
  key: "anchor-value-cap",
  label: "Anchor value cap",
  description: "The stored value must stay well below the expected next-visit spend so the return visit brings new cash.",
  critical: false,
  appliesTo: ["checkout_offer"],
  check(input, settings) {
    const deal = input.offer?.deal;
    if (!deal) return skip();
    const cap = settings.guardrails.anchorValueCapRate * deal.expectedNextVisitSpendCents;
    const perVisit = deal.perVisitCoveredRetailCents ?? deal.coveredRetailCents;
    return perVisit <= cap ? pass() : fail("Anchor would pay for too much of the next visit");
  },
};
