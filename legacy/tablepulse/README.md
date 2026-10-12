# TablePulse

A Next.js App Router MVP for occasional table rewards that protect incremental gross profit. Includes a Singapore venue demo, staff operations, a tablet display, a rules engine, and a Supabase production repository. No payment processing.

## Run the demo

Node 22.13+ (Node 24 recommended) and pnpm 11+:

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Open the URL printed by Next.js. Demo mode is also the development default when Supabase is not configured. The dashboard starts with The Sunday Social, 20 menu items, 12 tables, five campaigns, two pending rewards and one redeemed bottle pairing. **POS simulator → Reset demo** restores these samples, including fresh countdowns. The account menu switches between manager, staff and platform admin for role demonstrations.

Demo changes persist in `.demo/state.json`. Its process-local queue and atomic file replacement are for one local Node process, not a distributed deployment. `TABLEPULSE_DEMO=true` is an explicit demo override; **set it to false for live use**. There is no silent production fallback to demo storage. The anonymous demo relaxes the verified-customer-reference requirement so the full flow is easy to try; caps still apply to associated customers.

## Application areas

| Route              | Use                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `/`                | Service overview, revenue/profit, floor, live rewards and decision feed                                      |
| `/tables`          | Open visits, enter orders, guest safety, customer linking, redemption, voids, cancellations and bill closure |
| `/offers`          | Campaign prices, allocations, priorities and enable/disable controls                                         |
| `/menu`            | 20-item menu, item costs, gross profit/margin, stock and promotion eligibility                               |
| `/analytics`       | Conversion by type, discount cost, cap/rejection counts, CSV export and matched control comparisons          |
| `/activity`        | All eligibility decisions and staff audit events                                                             |
| `/settings`        | Profit/score floors, randomness, controls and campaign pause                                                 |
| `/simulator`       | Mock canonical POS events and four service scenarios                                                         |
| `/display/[token]` | Login-free, session-bound tablet display with a QR for optional member enrolment                             |
| `/login`           | Supabase team authentication                                                                                 |
| `/member`          | Customer phone OTP, permanent membership, personalisation choices and staff-confirmed table check-in         |

## Supabase setup

1. Create a Supabase project. Apply all SQL migrations in chronological order (`202610070001_tablepulse.sql`, `202610080001_members.sql`, then `202610090001_agent_margin.sql`) with the SQL editor or run `supabase db push` after linking the project. Existing deployments apply only migrations newer than their current version.
2. To load sample data, regenerate current timestamps with `pnpm seed:generate`, then run `supabase/seed.sql`. This is optional for live venues. SQL seeds are idempotent inserts; they do not reset existing live records. Local CLI setup is in `supabase/config.toml`; `supabase start` / `supabase db reset` requires Docker.
3. In Authentication, create venue team users. Public signup is disabled in the local config. Provision each membership as a trusted administrator:

```sql
insert into public.venue_users(venue_id,user_id,role)
values ('11111111-1111-4111-8111-111111111111', '<auth-user-uuid>', 'manager');
-- role: platform_admin, manager, or staff
```

4. Set environment values, then restart/rebuild:

```dotenv
TABLEPULSE_DEMO=false
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
TABLEPULSE_VENUE_ID=11111111-1111-4111-8111-111111111111
TABLEPULSE_TOKEN_SECRET=<random-secret-at-least-32-characters>
TABLEPULSE_CUSTOMER_SECRET=<independent-stable-secret-at-least-32-characters>
TABLEPULSE_WEBHOOK_SECRET=<independent-random-secret-at-least-32-characters>
NEXT_PUBLIC_APP_URL=https://your-app.example
```

Generate each secret separately with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The service-role key must never have a `NEXT_PUBLIC_` prefix. Keep the customer secret stable: changing it changes pseudonymous customer IDs and requires a migration of customer history. Display-token rotation is independent.

V1 runs one selected venue per deployment. Platform admins can manage that venue and provision team roles through Supabase; fleet switching and self-service invitations are not included. Normalized records all carry venue IDs and RLS, ready for a future fleet administration surface.

## Customer phone accounts and membership

Open `/member` or scan the QR on a table screen on the customer's own phone. Demo mode generates a random five-minute verification code, displayed with an explicit **Demo verification** label; it sends no SMS and is not proof of identity. Use fictional numbers. Demo codes are stored only as HMAC digests, allow five verification attempts, and cannot be replayed. Phone numbers are normalized to international E.164 format (for example `+6581234567`) and are not saved in demo state; a keyed pseudonymous digest identifies repeat sign-ins. A signed HttpOnly demo cookie expires after 24 hours. Resetting demo data also removes demo accounts.

Live mode uses Supabase `signInWithOtp` / `verifyOtp`. Set up a real Supabase project, apply all migrations, enable **Phone** authentication and phone signups, configure an SMS provider, and enable **hCaptcha** in Supabase Auth. Register the deployment domain with hCaptcha and put its secret in Supabase, not in public app variables. Set:

```dotenv
TABLEPULSE_PHONE_LOGIN_ENABLED=true
NEXT_PUBLIC_HCAPTCHA_SITE_KEY=<your-public-hcaptcha-site-key>
```

Rebuild after changing the public site key. Configure Supabase OTP expiry (recommend five minutes), resend/verification limits, SMS provider fraud controls and spending alerts. The app requires a captcha response for live OTP requests, enforces one request per phone per minute, five per phone per hour, and a venue-wide 60 requests/hour budget in Postgres. Fixed windows can allow bursts across a boundary; provider and reverse-proxy rate limits remain necessary. These conservative budgets are currently code constants. No raw phone numbers or OTPs appear in audit logs. Hosted SMS delivery, CAPTCHA and real Supabase sessions still need end-to-end verification against your configured project.

Customer Auth uses independent `tablepulse-member-auth` HttpOnly cookies; staff email login uses its original Supabase cookie namespace. Only a server-verified Supabase user with a confirmed phone can access member operations. Customer signup never grants a venue team role. Phone data stays in Supabase Auth; `customers` links the immutable Auth user UUID to a random unique `TP-XXXXXXXXXX` membership number. Sign-in repeats preserve the account and membership number. A membership number is a lookup reference, not authentication. Customer phone changes must use Supabase's authenticated phone-change/recovery process while retaining the same Auth UUID; the MVP has no self-service recovery or account-merge UI.

After signing in, a guest scans the current display URL and requests a five-minute **check-in code**. Staff verifies the guest is at that table and enters the code under **Tables → Confirm member check-in**. This is separate from the SMS code and offer redemption code. It binds the nominated member to that visit; it creates no reward and cannot replace an already verified recipient. The next genuine organic order triggers evaluation. Five rejected check-ins temporarily block further confirmation for that session. Closed, expired, replayed and wrong-table codes fail. Never approve a check-in solely because someone knows a membership number or has a screenshot of a table QR.

For a real POS adapter, use `customerRef: "member:TP-XXXXXXXXXX"` when the POS has independently confirmed that member, or omit `customerRef` after staff has linked the session. The existing provider-reference flow remains supported. A differing verified POS reference is rejected rather than silently creating another identity or moving reward history. Existing POS profiles and member accounts are not automatically merged; reconcile that mapping before a live pilot. Membership is venue-scoped in V1.

Customers can opt into category preferences and linked-visit personalisation, or withdraw that choice from their account. No marketing subscription is created. Account, bill and abuse-protection history persist after personalisation withdrawal; the venue must publish its retention policy and handle access/deletion requests. Linked visits are **associated table bills**, not individual consumption. The portal shows recent confirmed bills, without other customers' profiles or staff activity. The optional offer agent uses explicit preferences and coarse category summaries only when this consent is active. A self-training purchase model is not included.

`member_checkins` stores hashed check-in codes with RLS and service-only access. They are omitted from all workspace/public responses. The repository's second migration extends atomic commit/snapshot functions to preserve them and makes membership IDs, Auth identities and consumed visit opportunities immutable. One active reward per customer is checked at allocation and in the database transaction, at the current deployment's venue scope.

## Architecture

```text
POS → vendor PosAdapter → signed canonical webhook → authenticated Next.js route
                                                   ↓
                         hard-rule candidate filter → optional AI ranker
                                                   ↓
                              repository transaction → final rule check
                                                   ↓
                             Postgres RPC + row lock + revision check
                                                   ↓
                 relational orders / stock / offers / history / audit / redemption
                             ↓                              ↓
              Supabase Realtime (team)        safe public snapshot (3-second poll)
```

`lib/engine.ts` contains the rules, fixed commercial floors and weighted scoring, independent of Next and storage. `lib/server/offer-agent.ts` is an optional constrained ranker: it receives only server-approved candidates and returns an approved ID or `NO_OFFER`. `lib/server/commands.ts` implements state transitions. `lib/server/store.ts` switches between the local demo and Supabase. Supabase's snapshot RPC reconstructs the typed state from normalized tables; the commit RPC persists all effects in one database transaction. Generated columns expose menu price, category, alcohol and age fields; `menu_margins` derives GP and gross margin from current item costs. JSON payloads retain the typed application representation alongside relational keys, constraints, costs and stock.

Venue row locks and optimistic revision retries serialize allocation, stock and redemption updates. Unique constraints enforce one open visit per physical table, one instance per visit, one redemption per instance, and unique external event IDs. Customer advisory locks and SQL history checks defend frequency caps. RPC execution and writes are service-only. RLS permits authorized team reads, and reserves customer profiles/consents/history to managers. Role checks happen on every server mutation, not just in navigation.

The team receives Supabase Realtime changes for offer instances, table sessions and inventory, with polling as a fallback. Public screens deliberately receive minimal snapshots through token verification rather than anonymous database access. They clear stale content on connection failure and after expiration. Closing a bill revokes its token immediately; signed tokens also expire 12 hours after visit start.

## Decision rules

Only non-voided organic orders qualify. Existing discounts, staff blocks, closed visits, consumed table opportunities, customer caps, unavailable inventory, alcohol safety failures and venue pause withhold the reward. Campaign candidates must match the basket, avoid target items already ordered, exceed the absolute incremental-profit floor, meet the percentage-margin floor, exceed the score floor, pass real daily caps, and avoid repeat promotions within 60 days. Defaults are more than **S$2.50** incremental gross profit and at least **30%** gross margin. Managers can change these goals; the agent cannot. Allocated visits are never given another reward after cancellation or expiry.

Score out of 100: relevance up to 30 (including 2 for opted-in preferences), GP up to 25, stock up to 15, frequency 10 after caps pass, campaign priority up to 10, and cryptographic randomness up to 10. Eligible candidates also pass probabilistic allocation. A visit is assigned to a control cohort once at opening. Waiting never triggers evaluation; a new organic POS event does.

### Optional offer-ranking agent

The signed POS/n8n endpoint can ask an AI agent to choose among candidates that have already passed the hard rules and commercial floors. It may return one allowlisted offer ID or `NO_OFFER`; its strict structured response is validated and the selected choice is checked again during the database transaction. A timeout, API error or invalid answer falls back to the deterministic scorer and records that fallback in the audit log.

Enable it only on the server:

```dotenv
TABLEPULSE_AGENT_ENABLED=true
TABLEPULSE_AGENT_MODEL=gpt-6-astra
OPENAI_API_KEY=<server-only-provider-key>
```

The request uses `store:false`. It contains basket categories and candidate economics, plus explicit preferences and aggregate category counts from up to ten associated visits in the past 180 days only for an opted-in member. It excludes phone numbers, names, customer IDs and raw line-item history. The agent is a constrained ranker, not a self-training model. Real provider authentication, latency, cost and privacy terms must be validated with the deployment's own account before launch.

Once a basket produces a safe, profitable campaign match, that visit's opportunity is consumed even when its score or random allocation results in no offer. Further orders and staff override requests cannot reroll it. Empty or nonmatching baskets do not consume the opportunity. Customer recognition never resets it. Real POS adapters must preserve visit identity across table moves, bill splits and reopen events; staff-generated sessions alone cannot enforce those vendor lifecycle semantics.

Commercial templates include food-only drink pairing, beer-to-snack add-on, main/glass-of-wine bottle pairing, profitable premium side, and pairing on a new purchase for an opted-in customer with an unused return entitlement. The seeded return entitlement demonstrates the latter rule; issuance of a new return entitlement remains a loyalty/POS responsibility in V1.

Live subsidised rewards require a verified customer: a phone-authenticated member confirmed at the table by staff, or a stable POS loyalty reference confirmed through a trusted adapter or staff workflow. Without one, the engine logs a withholding decision; the menu screen still works. POS references are HMAC-pseudonymized and never placed on public screens. Venue staff and the POS are trusted to verify that the reference belongs to the guest. Preference consent is separate from customer identification, and anonymous QR enrolment is not identity verification. Caps apply to that identified customer; reliable identity across unrelated venues/providers requires a future platform identity service.

Redemption checks all safety conditions again, including original qualifying orders, current stock, both profit floors, expiry, and table/bill identity. Only authenticated staff can redeem a six-character code within its original session. Success adds a non-organic reward line to the bill, consumes stock and records revenue, cost and estimated profit. No checkout/payment happens. Screenshots can be taken, but possession of an image or code alone cannot redeem, transfer or save a reward. Five rejected attempts in five minutes temporarily block redemption for the session. Staff flags cancel affected pending rewards. Editing campaigns cancels pending instances rather than changing their displayed terms. Voiding an original qualifying order cancels an unredeemed reward; already redeemed bills require the external POS correction/refund process.

Analytics derives all displayed numbers from stored events. Estimated incremental GP equals reward purchase revenue minus item costs. It assumes an additional purchase, so it is **not causal lift**. Matched controls use nearest organic basket spend within 30%, display incomplete visits, and may reuse controls in the small demo. For a live experiment, use completed visits and enough samples, stratify by party size/basket/time, and account for selection effects, GST, service charges and changing cost bases. Prices in this demo are SGD and do not model tax or service charges.

## POS adapter and API

Implement the `PosAdapter` interface in `lib/pos/adapter.ts` for a vendor. Normalize vendor IDs, menu IDs and session mapping into the canonical event, verify vendor signatures at the boundary, and send a stable event ID. Mock scenarios use the same ingestion and engine. Duplicate identical IDs return success without another order/decision; a reused ID with a different order is rejected.

```json
{
  "externalId": "pos-order-123",
  "sessionId": "<current-session-uuid>",
  "customerRef": "verified-loyalty-account-42",
  "items": [{ "menuItemId": "<menu-item-uuid>", "quantity": 2 }],
  "discount": false
}
```

`POST /api/pos/events` and `POST /api/offers/evaluate` both ingest a canonical order and evaluate atomically. The latter is an n8n-compatible alias, not an arbitrary unauthenticated reroll endpoint. Sign the exact raw UTF-8 JSON string:

```text
x-tablepulse-timestamp = Unix seconds
x-tablepulse-signature = HMAC-SHA256(webhook_secret, timestamp + "." + raw_body), lowercase hex
```

Timestamps have a five-minute replay window; stable external IDs prevent replayed orders. `scripts/webhook-example.cjs` is an executable sample. Browser staff operations use same-origin `POST /api/commands`, validated by Zod, with secure Supabase session cookies in live mode. API responses have no-store caching.

## n8n integration points

n8n is orchestration only. Postgres stores records; TablePulse owns the eligibility rules, fixed goals, optional AI ranking and final transaction.

An inactive, credential-free workflow is now provided in [`integrations/n8n/tablepulse-pos-decision.json`](integrations/n8n/tablepulse-pos-decision.json). It receives authenticated canonical POS orders, signs the exact request body, calls the existing order/evaluation endpoint and returns shown, withheld, control or duplicate outcomes. See the [n8n setup guide](integrations/n8n/README.md) for credential selection, POS mapping, retries and testing, and the [decision explanation](integrations/n8n/decision-process.md) for the current algorithm. The workflow is prepared for import; it has not been activated on a connected n8n instance.

| Workflow              | Integration                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| POS order             | Webhook → vendor payload normalizer → sign raw canonical body → HTTP POST `/api/offers/evaluate`; retry with the same `externalId`            |
| Daily summary         | Schedule Trigger at a manager-selected Singapore time → signed GET `/api/integrations/summary?since=<ISO-timestamp>` → email or WhatsApp node |
| Low inventory         | Scheduled summary GET → filter `lowInventory` → deduplicate item/threshold alerts → manager channel                                           |
| Suspicious redemption | Summary GET → `suspicious` events → deduplicate audit ID → staff/manager alert                                                                |
| Customer opt-out      | Consent/CRM webhook → signed POST `/api/integrations/optout` with `{ "customerId": "<pseudonymous-id>" }`                                     |

For GET summary, sign `timestamp + "."` (empty body). Summary accepts a manager's normal browser session as well. The `since` cursor scopes financial totals and audit alerts; inventory reports current stock. Track the last successful cursor in n8n and move it only after delivery succeeds. Keep webhook secrets in n8n credentials, never a public workflow export. Connect your own email/WhatsApp accounts and recipients; the MVP does not send messages by itself. Opt-out disables preferences and the return entitlement while retaining reward/audit records for abuse protection. Configure a venue retention/deletion policy before handling real customer records.

## Deploy

Deploy the Next.js server on Vercel or a Node host; connect your Supabase project. `pnpm build` produces standalone output. Set public Supabase variables **at build time** and server secrets at runtime. `TABLEPULSE_DEMO` must be false for live operation. Runtime rendering loads the venue; build does not need database credentials.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`Dockerfile` includes a non-root standalone runtime. Build with public Supabase URL/key arguments, then supply runtime secrets with your hosting secret manager. Use HTTPS and a reverse proxy/WAF with request-size and IP rate limits, especially on login, enrolment and screen polling. The app limits parsed API payloads to 64 KiB; infrastructure should reject oversized/slow requests before reading them. Use a durable database in every live replica. Do not host this as a static export: auth, tokens, transactions and POS ingestion require a server.

## Verification and boundaries

`pnpm test` exercises the eligibility and redemption rules plus migration/seed, atomic writes, concurrency revision rejection, rollback, single-use redemption and RLS using a local PostgreSQL WASM runtime. Supabase's auth gateway, hosted Realtime delivery and a real POS still need verification against your project and provider. The seed contains invented venue data only. No external venue, POS, messaging account or payment connection is configured.

With the local demo running, `node scripts/member-smoke.cjs` checks the membership API journey, OTP replay/limits, consent, profile isolation, wrong-table and reused check-in codes, and logout. `node scripts/smoke.cjs` checks the existing POS/display/reward routes. Both scripts refuse live mode and reset disposable demo data before/after the checks; do not run them against a shared demonstration that must retain its state.

Security controls include server-only service credentials, authenticated role checks, HMAC tokens, token revocation/expiry, origin checks, signed POS webhooks, idempotency, atomic constraints, minimal public responses, frequency guards and audit logging. Add infrastructure rate limiting, monitoring/backups and POS-specific correction/reconciliation handling before a public live pilot. V1 treats the verified table's linked customer as the subsidy recipient; identifying every guest in a shared party needs a future per-guest redemption model.
