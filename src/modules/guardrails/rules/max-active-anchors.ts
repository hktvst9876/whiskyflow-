import type { GuardrailRule } from "../types";
import { fail, pass, skip } from "./helpers";

export const maxActiveAnchors: GuardrailRule = {
  key: "max-active-anchors",
  label: "Maximum active anchors",
  description: "A customer can hold a limited number of open anchors at once, so value is used rather than piled up.",
  critical: false,
  appliesTo: ["checkout_offer"],
  check(input, settings) {
    if (!input.customer?.identified) return skip("Anonymous customer");
    const max = settings.guardrails.maxActiveAnchors;
    return input.customer.activeAnchorCount < max ? pass() : fail(`Already holds ${input.customer.activeAnchorCount} open anchors`);
  },
};
