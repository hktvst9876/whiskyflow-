# messaging — WhatsApp templates, timing and the outbox

**Owns:** `messages` (outbound and inbound; status, suppress reason, cost, dedupe key).

**Public API:** `TEMPLATES`, `renderTemplate`, `buildButtons` (`templates.ts`); `firstReminderAt`, `expiryWarningAt`, `winBackDue`, `nextSendSlot` (`timing.ts`); server `repo.ts` (insert with dedupe, `claimDueMessages` with SKIP LOCKED, counts).

Planning and dispatch are flows (`src/flows/messages.ts`); the send-time policy is the guardrail engine with kind `message`. Copy talks about what the customer OWNS. For Meta, each template must exist in WhatsApp Manager with the same name and variable order.
