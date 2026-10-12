import type { GuardrailRule } from "../types";
import { fail, isPromotional, pass, skip } from "./helpers";

/** One promotion at a time: never stack an offer on a bill or on an unused promotion. */
export const noStacking: GuardrailRule = {
  key: "no-stacking",
  label: "No stacking",
  description: "An offer cannot be combined with another promotion on the same bill, and customers hold at most one unused promotion.",
  critical: true,
  appliesTo: ["checkout_offer", "message_offer"],
  check(input) {
    if (input.kind === "checkout_offer") {
      return input.visit?.hasOtherPromo ? fail("This bill already has a promotion or perk") : pass();
    }
    if (!input.offer || !isPromotional(input.offer)) return skip("Not a promotion");
    const open = (input.history ?? []).some(
      (e) => e.status === "shown" && isPromotional(e) && e.channel !== "pos" && e.channel !== "staff_upsell",
    );
    return open ? fail("Customer already holds an unused promotion") : pass();
  },
};
