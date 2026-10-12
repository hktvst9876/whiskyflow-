import type { GuardrailRule } from "../types";
import { DAY_MS, fail, pass, skip } from "./helpers";

/** Vary offer types so no single promotion becomes an expectation. */
export const varyOfferType: GuardrailRule = {
  key: "vary-offer-type",
  label: "Vary offer type",
  description: "Do not repeat the same promotional offer type back to back within 60 days.",
  critical: false,
  appliesTo: ["message_offer"],
  check(input) {
    if (!input.offer || input.offer.offerType === "anchor_upgrade") return skip();
    const last = [...(input.history ?? [])]
      .filter((e) => e.offerType !== "anchor_upgrade" && e.channel !== "staff_upsell")
      .sort((a, b) => b.shownAt.getTime() - a.shownAt.getTime())[0];
    if (!last || input.now.getTime() - last.shownAt.getTime() > 60 * DAY_MS) return pass();
    return last.offerType === input.offer.offerType ? fail("Same offer type as their last promotion") : pass();
  },
};
