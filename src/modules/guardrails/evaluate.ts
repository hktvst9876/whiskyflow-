/**
 * evaluateGuardrails(input, rules, settings) → { allowed, results }.
 * Critical rules always run; non-critical rules can be disabled per merchant via
 * `settings.guardrails.disabledRules`. Deferring rules (quiet hours) do not block forever:
 * when they are the only failures, `deferUntil` tells the caller when to retry.
 */
import type { MerchantSettings } from "../merchants/settings";
import { GUARDRAIL_RULES } from "./rules";
import type { GuardrailEvaluation, GuardrailInput, GuardrailResult, GuardrailRule } from "./types";

export function evaluateGuardrails(
  input: GuardrailInput,
  settings: MerchantSettings,
  rules: GuardrailRule[] = GUARDRAIL_RULES,
): GuardrailEvaluation {
  const disabled = new Set(settings.guardrails.disabledRules);
  const results: GuardrailResult[] = [];
  for (const rule of rules) {
    if (!rule.appliesTo.includes(input.kind)) continue;
    const base = { key: rule.key, label: rule.label, critical: rule.critical };
    if (!rule.critical && disabled.has(rule.key)) {
      results.push({ ...base, passed: true, reason: "Disabled by merchant", skipped: true, disabled: true });
      continue;
    }
    results.push({ ...base, ...rule.check(input, settings) });
  }
  const blockedBy = results.filter((r) => !r.passed);
  const hardBlocks = blockedBy.filter((r) => !r.deferUntil);
  const deferrals = blockedBy.filter((r) => r.deferUntil);
  const deferUntil =
    hardBlocks.length === 0 && deferrals.length > 0
      ? new Date(Math.max(...deferrals.map((r) => r.deferUntil!.getTime())))
      : null;
  return { allowed: blockedBy.length === 0, deferUntil, results, blockedBy };
}

/** Rules a merchant may switch off (for the settings screen). */
export function configurableRules(rules: GuardrailRule[] = GUARDRAIL_RULES) {
  return rules.map((r) => ({ key: r.key, label: r.label, description: r.description, critical: r.critical, appliesTo: r.appliesTo }));
}
