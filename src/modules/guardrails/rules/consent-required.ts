import type { GuardrailRule } from "../types";
import { fail, pass, skip } from "./helpers";

export const consentRequired: GuardrailRule = {
  key: "consent-required",
  label: "Consent required",
  description: "Service messages need service consent; marketing needs marketing consent; opt-outs always win.",
  critical: true,
  appliesTo: ["message"],
  check(input) {
    const m = input.message;
    if (!m) return skip();
    const r = m.recipient;
    if (r.status !== "active") return fail("Customer record is anonymised");
    if (!r.phoneE164) return fail("No phone number");
    if (m.category === "service_reply") return pass();
    if (m.category === "marketing") {
      if (r.optedOutAt || !r.whatsappMarketingOptIn) return fail("No marketing consent");
      return pass();
    }
    return r.whatsappServiceOptIn ? pass() : fail("No consent for service messages");
  },
};
