import type { GuardrailRule } from "../types";
import { fail, pass, skip } from "./helpers";

export const minTodayMargin: GuardrailRule = {
  key: "min-today-margin",
  label: "Minimum margin today",
  description: "Today's bill margin, counting the stored item's full cost (no breakage), must stay above the minimum.",
  critical: true,
  appliesTo: ["checkout_offer"],
  check(input, settings) {
    const deal = input.offer?.deal;
    if (!deal) return skip();
    const min = settings.guardrails.minTodayMarginRate;
    return deal.todayMarginRate >= min
      ? pass()
      : fail(`Margin ${(deal.todayMarginRate * 100).toFixed(0)}% is below ${(min * 100).toFixed(0)}%`);
  },
};
