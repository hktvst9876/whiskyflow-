import type { GuardrailRule } from "../types";
import { fail, pass, skip } from "./helpers";

export const entitlementStillActive: GuardrailRule = {
  key: "entitlement-still-active",
  label: "Anchor still active",
  description: "Messages about an anchor are dropped once it is used up, expired or voided.",
  critical: true,
  appliesTo: ["message"],
  check(input) {
    const m = input.message;
    if (!m || m.entitlementActive === null) return skip();
    return m.entitlementActive ? pass() : fail("The anchor is no longer active");
  },
};
