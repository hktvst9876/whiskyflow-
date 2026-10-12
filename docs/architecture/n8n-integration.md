# n8n integration

n8n moves events between systems. Return Anchor remains the system of record and the only decision engine. This prevents a workflow edit from bypassing margin, consent, frequency, liability or holdout rules.

## Deal-decision workflow

Import [`n8n/pos-deal-decision.workflow.json`](../../n8n/pos-deal-decision.workflow.json) into n8n. Set these n8n environment variables:

- `RETURN_ANCHOR_URL`: the HTTPS origin of this app, without a trailing slash.
- `RETURN_ANCHOR_API_KEY`: a merchant-scoped key with `pos:write`.

Create that key once from the application workspace:

```bash
pnpm api-key:create -- --merchant abc-kitchen --name n8n
```

The raw key is printed once; store it in n8n's encrypted environment/credential store. Only its SHA-256 hash is retained by Return Anchor.

Configure the POS to send the canonical order to n8n's `return-anchor-pos-order` webhook. For a vendor-specific payload, put a mapping node before **Ask Return Anchor Engine**, or add a typed adapter under `src/integrations/pos` and set `X-POS-Adapter` to its key.

The engine response is returned unchanged:

```json
{
  "visitId": "...",
  "status": "open",
  "created": true,
  "offer": {
    "outcome": "offered",
    "exposureId": "...",
    "staffText": "Offer +$8 → 1 Main Waiting",
    "script": "For another $8...",
    "priceCents": 800,
    "label": "1 Main Waiting",
    "reason": ""
  },
  "closeError": null
}
```

`outcome` may be `offered`, `holdout`, `blocked` or `no_eligible`. n8n must display the returned outcome; it must not retry to obtain a different offer. The decision is stored against `externalRef`, so transport retries return the same decision.

## Scheduler workflow

Create a five-minute Schedule Trigger followed by an HTTP Request:

- Method: `POST`
- URL: `{{$env.RETURN_ANCHOR_URL}}/api/cron/tick`
- Header: `Authorization: Bearer {{$env.RETURN_ANCHOR_CRON_SECRET}}`
- Retry on network/5xx failure with exponential backoff

The application handles expiry, score refreshes, reminder planning, consent, quiet hours, frequency limits and message dispatch. n8n only invokes the tick.

## Operational workflows

Use separate notification workflows for daily summaries, low inventory and suspicious redemption alerts. They should consume protected application endpoints or signed webhooks, then send email/WhatsApp notifications. Customer opt-outs must first update Return Anchor's consent ledger; n8n may then mirror the result to a CRM.

Do not store customer phone numbers in workflow definitions or execution logs. Limit n8n execution retention and redact headers so API keys do not appear in run history.
