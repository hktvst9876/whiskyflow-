import type { GuardrailRule } from "../types";
import { DAY_MS, fail, pass, skip } from "./helpers";

/** Don't remind someone who was just here. */
export const recentlyVisited: GuardrailRule = {
  key: "recently-visited",
  label: "Recently visited",
  description: "Skip reminders when the customer visited within the last few days.",
  critical: false,
  appliesTo: ["message"],
  check(input, settings) {
    const m = input.message;
    if (!m || !m.isReminder) return skip("Not a reminder");
    const last = m.recipient.lastVisitAt;
    const days = settings.messaging.recentlyVisitedDays;
    if (!last || days === 0) return pass();
    return input.now.getTime() - last.getTime() < days * DAY_MS ? fail(`Visited within the last ${days} days`) : pass();
  },
};
