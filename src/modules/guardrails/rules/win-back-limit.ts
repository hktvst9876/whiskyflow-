import type { GuardrailRule } from "../types";
import { fail, pass, skip, within } from "./helpers";

export const winBackLimit: GuardrailRule = {
  key: "win-back-limit",
  label: "Win-back limit",
  description: "Limit aggressive win-backs: at most N per customer per window.",
  critical: false,
  appliesTo: ["message_offer"],
  check(input, settings) {
    if (!input.offer?.isWinBack) return skip("Not a win-back");
    const g = settings.guardrails;
    const count = within(input.history, input.now, g.winBackWindowDays).filter((e) => e.offerType === "win_back_perk").length;
    return count < g.winBackMaxPerWindow ? pass() : fail(`Already won back within ${g.winBackWindowDays} days`);
  },
};
