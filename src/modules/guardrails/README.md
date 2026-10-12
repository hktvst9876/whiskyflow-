# guardrails — offer and message rules

**Public API:** `evaluateGuardrails(input, settings, rules?) → { allowed, deferUntil, results, blockedBy }`, `configurableRules()`; one rule per file in `rules/`, registered in `rules/index.ts`.

Kinds: `checkout_offer` (anchor upgrades at the till), `message_offer` (offers attached to WhatsApp), `message` (send-time policy). Critical rules cannot be switched off by merchants. Deferring rules (quiet hours, marketing caps) return `deferUntil` instead of dropping a message.

**How to change**
- Add a rule: new file exporting a `GuardrailRule`, add to `GUARDRAIL_RULES`, add a test in `evaluate.test.ts`. Thresholds live in settings (`guardrails`, `messaging`), never inline.
