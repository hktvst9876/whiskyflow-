# Engineering Blueprint (the contract)

This is the binding engineering contract for the Return Anchor codebase. Every module,
table, algorithm and convention here is the source of truth for implementers. Product
reasoning lives in `docs/product/` and `docs/engines/`; this file says **where things go
and how they fit**.

> Product in one line: a retention operating system built around *unfinished customer
> value*. Merchants deliberately create a small, valuable, customer-owned **Return Anchor**
> ("1 Main Waiting", "2 pints left", "Macallan 42% remaining", "2 massages remaining"),
> remind the customer, monetise the return visit, and prove incremental profit against a
> randomised holdout.

---

## 1. Principles that shape the code

1. **Pure logic is separate from IO.** Every business decision (deal economics, guardrails,
   return score, segments, upsell ranking, message timing, attribution maths, experiment
   assignment) is a pure function in a module file with no database, network or Next.js
   import. These files are unit-tested and are where most future edits happen.
2. **Editable numbers live in config files**, never inline. Thresholds, weights, priors,
   timings and copy are in `config.ts` files (module level) or `src/config/defaults.ts`
   (cross-module), and merchant overrides are stored as JSON settings validated by Zod.
3. **One folder per business capability** (`src/modules/<name>`), each with a `README.md`
   explaining what it owns and how to change it.
4. **Cross-module workflows live in `src/flows/`.** The MVP retention loop (checkout offer
   → issue anchor → claim → remind → redeem → upsell → next anchor) is readable top to
   bottom in a handful of flow files. Modules never orchestrate other modules.
5. **`app/` is routing only.** Pages compose module queries and UI components; mutations go
   through module/flow server actions. No business logic in `app/`.
6. **Money is integer minor units (cents).** Quantities are integers (items, sessions,
   percent points). No floats are stored.
7. **The optimisation target is incremental profitable customer lifetime value**, never
   offers sent, messages sent, redemptions or prepaid value. The code must always be able to
   say: *did this intervention make the customer more valuable than without it?* → holdouts.
8. **Never rely on breakage.** Economics assume stored value is redeemed. The product
   actively encourages redemption and shows customers exactly what they own.

---

## 2. Technology stack

| Concern | Choice | Why |
|---|---|---|
| Web framework | Next.js 16 App Router, React 19, TypeScript strict | One deployable for console, staff POS-lite, customer wallet, APIs |
| Styling | Tailwind CSS 4 + small primitives in `src/ui` | No component-library lock-in; easy to restyle |
| Database | PostgreSQL (Supabase/Neon/RDS in production) | Relational ledger, transactions, row locks |
| Local/dev/test DB | PGlite (Postgres compiled to WASM) | Same SQL dialect, zero install, in-memory tests |
| ORM / migrations | Drizzle ORM + drizzle-kit | Typed schema in TS, generated SQL migrations |
| Validation | Zod 4 | Inputs, settings, env |
| Messaging | WhatsApp Business Cloud API behind a provider interface (`demo`, `console`, `meta`) | WhatsApp-first, testable without Meta |
| Auth | Built-in email+password (scrypt) with DB sessions; token links for customers | Self-contained; swappable via `src/modules/auth` |
| Tests | Node test runner + tsx (`scripts/run-tests.mjs`) | No extra framework |

Not in MVP (seams exist): Apple/Google Wallet passes, POS vendor adapters, payments,
bookings, ML models. See `docs/product/roadmap.md`.

---

## 3. Repository layout

```
app/                         Next.js routes only (thin)
  (console)/                 Merchant console (owner/manager): today, opportunities, customers,
                             campaigns, offers, reports, messages, settings/*, onboarding
  (staff)/staff/             Staff POS-lite (tablet/phone first): visits, offer, claim, redeem, keep
  c/[token]/                 Customer claim page (public, token)
  w/[token]/                 Customer wallet (public, token)
  login/ signup/             Auth pages
  api/v1/pos/orders/         POS canonical order ingestion (API key)
  api/webhooks/whatsapp/     Meta webhook (GET verify, POST events)
  api/cron/tick/             Scheduler tick (CRON_SECRET)
  api/health/                Liveness
src/
  config/                    env.ts (validated env), brand.ts, defaults.ts (cross-module defaults)
  core/                      Shared kernel: money, time, ids, crypto, errors, phone, result, logger
  server/                    Infrastructure: db client, schema barrel, migrations runner, request context
  integrations/              Adapters to the outside world, each behind an interface
    whatsapp/                provider.ts (interface) + demo.ts + console.ts + meta-cloud.ts + signature.ts
    wallet-passes/           provider.ts + apple.ts + google.ts (stubs, Phase 2)
    pos/                     adapter.ts (interface) + canonical.ts
  modules/                   Business capabilities (see §4)
  flows/                     Cross-module use-cases = the retention loop (see §6)
  ui/                        Shared UI primitives + app shells (no business logic)
  verticals/                 Vertical presets (restaurant, bar, beer_pub, cafe, salon, spa, fitness, car_care)
drizzle/                     Generated SQL migrations (do not edit by hand; run `pnpm db:generate`)
scripts/                     run-tests.mjs, db-migrate.ts, db-seed.ts, db-reset.ts
tests/integration/           Flow/service tests against in-memory PGlite
docs/                        Product, engines, architecture, examples, risks
legacy/tablepulse/           Previous prototype, preserved for reference (not built)
```

Path alias: `@/*` → `src/*`. Example: `import { formatMoney } from "@/core/money"`.

### 3.1 Module anatomy

Every folder in `src/modules/<name>/` follows the same shape (files only when needed):

| File | Kind | Rule |
|---|---|---|
| `README.md` | doc | What it owns, public API, invariants, "how to change X" |
| `types.ts` | isomorphic | Domain types for this module |
| `config.ts` | isomorphic | Editable defaults (weights, thresholds, copy) |
| `*.ts` (logic) | isomorphic, **pure** | No IO. Takes data + `now` in, returns data out |
| `*.test.ts` | test | Unit tests next to the logic |
| `schema.ts` | server | Drizzle tables owned by the module. Imports only `drizzle-orm/*` and other `schema.ts` files via **relative** paths |
| `repo.ts` | server-only | Data access. Every function takes `db: DbOrTx` first |
| `service.ts` | server-only | Module-internal mutations that must hold invariants (e.g. ledger) |
| `queries.ts` | server-only | Read models for pages (view-model shaped) |
| `actions.ts` | `'use server'` | Thin server actions: validate → authorise → call flow/service → revalidate |
| `ui/*.tsx` | React | Components specific to the module |
| `index.ts` | isomorphic | Public exports of types + pure logic only (never server code) |

Server-only files start with `import "server-only";`.

### 3.2 Dependency rules

```
app ─► modules(actions, queries, ui) ─► flows ─► modules(service, repo, pure) ─► server/db, integrations ─► core, config
ui (src/ui) ─► core only
module pure logic ─► core, config, other modules' pure logic (via their index.ts)
module repo/service ─► server/db, own schema, other modules' schema (read joins OK), core
flows ─► any module's repo/service/pure logic, integrations
```

- A module's `service.ts` may not call another module's `service.ts`. If two modules must
  change together, that is a **flow**.
- Client components must never import `repo.ts`, `service.ts`, `queries.ts` or `server/*`.
- Integrations are accessed through their interface (`getWhatsAppProvider()`), never by
  importing a concrete provider in business code.

---

## 4. Modules

| Module | Owns (tables) | Responsibility |
|---|---|---|
| `auth` | users, memberships, sessions, rate_limits | Login/logout, password hashing, sessions, role guards (`requireAuth`), demo accounts |
| `merchants` | merchants, locations, app_state | Merchant profile, vertical, currency/timezone, **settings** (Zod schema + defaults + presets), business hours/off-peak/blackouts, demo clock |
| `catalog` | catalog_items | Menu/service items with price & cost, categories, anchorable flags, tags, CSV import |
| `customers` | customers, customer_consents, wallet_tokens | Customer profile per merchant, phone identity, consent log, wallet links, redeem codes, aggregates, privacy (anonymise) |
| `visits` | visits, visit_lines | POS-lite visits and lines, basket maths, close visit |
| `anchors` | anchor_programs, entitlements, entitlement_events | Anchor programs (merchant rules), entitlements (customer-owned), append-only ledger, issue/claim/redeem/level/expire/void, customer-facing labels, transparency terms |
| `deals` | — | **Dynamic deal engine** (pure): basket → anchor upgrade candidates → economics → acceptance model → best offer |
| `offers` | offer_definitions, offer_decisions, offer_exposures | Offer type registry (one file per type), merchant offer/perk definitions, decision log (one opportunity per visit), exposure tracking & performance |
| `guardrails` | — | Rule registry (one file per rule) + evaluation engine + config |
| `experiments` | experiments, experiment_assignments | Deterministic holdout assignment, experiment lifecycle |
| `scoring` | (writes score columns on customers) | Return Score model + segmentation + playbooks + next recommended action |
| `upsell` | — | Next-visit recommendations at redemption (pure) |
| `messaging` | messages | Templates, rendering, timing policy, send-time policy (consent, quiet hours, caps), outbox, provider dispatch, inbound handling |
| `campaigns` | campaigns, campaign_recipients | Suggested campaigns per segment, launch with holdout, performance |
| `analytics` | — | Dashboard read models, revenue attribution, experiment lift statistics |
| `fraud` | fraud_flags | Anomaly rules and scans |
| `audit` | audit_log | Append-only audit writer |
| `integrations-admin` (in `merchants`) | api_keys, webhook_events | API keys for POS, webhook idempotency |
| `demo` | — | Synthetic demo data (4 merchants), reset, time travel |

`src/verticals/` holds presets (categories, sample catalog, default anchor programs, upsell
complement map, timing defaults, copy). Adding a vertical = adding one file + registering it.

---

## 5. Data model (PostgreSQL)

All tables have `id uuid pk default gen_random_uuid()` unless noted, and every business
table carries `merchant_id` (multi-tenant from day one). Timestamps are `timestamptz`.
Money columns end in `_cents` (integer). Status/enum columns are `text` with a TS enum list.

### Tenancy, auth, integration
- **merchants**: name, slug (unique), vertical, currency (ISO 4217, default `SGD`), timezone
  (default `Asia/Singapore`), locale (default `en-SG`), country (default `SG`), brand_color,
  settings jsonb (merchant overrides; parsed with defaults), status (`active|paused`), created_at.
- **locations**: merchant_id, name, address, created_at. (MVP uses one per merchant.)
- **users**: email (unique, lowercase), name, password_hash, created_at, last_login_at.
- **memberships**: user_id, merchant_id, role (`owner|manager|staff`), created_at; unique(user_id, merchant_id).
- **sessions**: token_hash (unique), user_id, merchant_id (active merchant), created_at,
  expires_at, last_seen_at, user_agent.
- **rate_limits**: key text pk, window_start, count.
- **api_keys**: merchant_id, name, prefix, key_hash (unique), scopes text[], created_by,
  created_at, last_used_at, revoked_at.
- **webhook_events**: source (`whatsapp|pos`), external_id, merchant_id null, payload jsonb,
  received_at, processed_at, error; unique(source, external_id).
- **app_state**: key text pk, value jsonb, updated_at (demo clock offset etc.).
- **audit_log**: merchant_id null, actor_type (`user|staff|customer|system|api`), actor_id,
  action, entity_type, entity_id, data jsonb, created_at.

### Catalog & anchors
- **catalog_items**: merchant_id, name, category (text key from vertical preset or custom),
  kind (`product|service`), price_cents, cost_cents, active, anchorable, tags text[], sku null
  (unique per merchant; POS matching),
  description, sort_order, created_at, updated_at.
- **anchor_programs**: merchant_id, name, status (`active|paused|archived`), issue_mode
  (`upgrade_offer|stored_purchase`), unit_type (`item|percent|session`), unit_label,
  unit_label_plural, units_granted int, coverage jsonb (`{kind:'category', category,
  maxCoveredPriceCents?}` | `{kind:'items', itemIds}`), trigger jsonb (`{minBasketCents?,
  requiredCategoryCounts?, requiredItemIds?, minPartySize?}`), pricing jsonb (`{minPriceRate,
  maxPriceRate}` — fractions of covered retail, 0.25 = 25%), validity_days, redemption jsonb
  (`{allowedWeekdays?, offPeakOnly?, requiresNewPurchase?, minNewSpendCents?,
  maxUnitsPerVisit?}`), transferable, refund_policy
  (`none|unused_within_14_days|unused_any_time`), upgrade_allowed, terms text, created_at, updated_at.
- **entitlements** (a Return Anchor owned by a customer): merchant_id, customer_id null
  (until claimed), program_id null, origin_visit_id null, item_id null, issue_mode
  (`upgrade_offer|stored_purchase`), display_name,
  unit_type, unit_label, unit_label_plural, quantity_initial int, quantity_remaining int
  (`>= 0` check), covered_category null, max_covered_price_cents null, unit_retail_cents,
  unit_cost_cents (for `percent` these are the values of 100%; for a kept package such as a
  $50 bucket of 5 they are per unit, $10), price_paid_cents,
  storage_location null, expires_at null, transferable, terms_snapshot jsonb (frozen at
  issue), status (`pending_claim|active|fully_redeemed|expired|voided|refunded`),
  claim_token_hash unique null, claim_expires_at null, issued_by_user_id null, created_at,
  updated_at, version int (optimistic lock).
- **entitlement_events** (append-only ledger): merchant_id, entitlement_id, type
  (`issued|claimed|redeemed|level_recorded|adjusted|expired|voided|refunded|transferred`),
  quantity_delta int, quantity_after int, visit_id null, actor_type, actor_id null, note,
  created_at. Invariant: `quantity_after = previous + delta`, never negative.

### Customers
- **customers**: merchant_id, phone_e164 null (unique per merchant when not null),
  display_name, redeem_code (unique per merchant), status (`active|anonymised`),
  first_visit_at, last_visit_at, visit_count, total_spend_cents, total_gp_cents,
  promo_visit_count, typical_gap_days null,
  avg_party_size_x10 (int, ×10), preferred_weekday null (0-6), preferred_hour null,
  whatsapp_service_opt_in bool, whatsapp_marketing_opt_in bool, opted_out_at null,
  return_probability_bp (0-10000 basis points) null, return_band (`high|medium|at_risk`) null,
  segment null, score_factors jsonb null, scored_at null, created_at, updated_at.
- **customer_consents** (append-only): merchant_id, customer_id, purpose
  (`service_messages|marketing_messages|terms`), granted bool, source
  (`claim_page|staff|whatsapp|wallet|import`), notice_version, created_at.
- **wallet_tokens**: merchant_id, customer_id, token_hash unique, created_at, last_used_at, revoked_at.

### Visits
- **visits**: merchant_id, location_id null, customer_id null, party_size, status
  (`open|closed|voided`), source (`staff|pos`), external_ref null (unique per merchant when
  not null), label (e.g. table name), opened_by_user_id null, opened_at, closed_at null.
- **visit_lines**: merchant_id, visit_id, item_id null, name, category, quantity,
  unit_price_cents, unit_cost_cents, line_type (`regular|anchor_upgrade|anchor_redemption|perk|discount`),
  entitlement_id null, offer_exposure_id null, created_at, voided_at null.
  - `regular`: normal sale. `anchor_upgrade`: the +$X paid today to create an anchor.
  - `anchor_redemption`: price 0, cost = cost of what was consumed from the anchor.
  - `perk`: complimentary item (price 0, cost > 0). `discount`: negative price line.

### Offers, experiments
- **offer_definitions**: merchant_id, offer_type, name, status, is_discount bool, config
  jsonb (type-specific), est_cost_cents, created_at, updated_at.
- **offer_decisions** (one opportunity per visit): merchant_id, visit_id, customer_id null,
  experiment_id null, arm (`treatment|holdout`) null, identified_at_assignment bool,
  outcome (`offered|holdout|no_eligible|blocked`), chosen jsonb null, candidates jsonb,
  context jsonb, policy_version, created_at. Unique(visit_id) for the checkout opportunity.
- **offer_exposures**: merchant_id, decision_id null, visit_id null, customer_id null,
  campaign_id null, message_id null, entitlement_id null, offer_type, channel
  (`pos|whatsapp|wallet|staff_upsell`), is_discount, payload jsonb, expected jsonb,
  offer_definition_id null, status (`shown|accepted|declined|expired|redeemed`),
  promo_cost_cents, value_cents, shown_at, responded_at null, expires_at null.
- **experiments**: merchant_id, key, name, holdout_bp (basis points), status (`running|stopped`), salt,
  started_at, stopped_at null; unique(merchant_id, key).
- **experiment_assignments**: merchant_id, experiment_id, unit_type (`customer|visit`),
  unit_id, arm, customer_id null, visit_id null, assigned_at; unique(experiment_id, unit_type, unit_id).

### Messaging, campaigns, fraud
- **messages**: merchant_id, customer_id null, direction (`outbound|inbound`), channel
  (`whatsapp`), template_key, category (`utility|marketing|service_reply`), to_phone,
  body, variables jsonb, buttons jsonb, status (`scheduled|sending|sent|delivered|read|failed|suppressed|cancelled|received`),
  scheduled_for, sent_at, provider, provider_message_id, error, suppress_reason,
  dedupe_key (unique per merchant, null allowed), entitlement_id null, campaign_id null,
  offer_exposure_id null, est_cost_cents, created_at, updated_at.
- **campaigns**: merchant_id, kind, name, segment, offer_definition_id null, status
  (`draft|scheduled|sending|completed|cancelled`), holdout_bp, audience_count,
  expected_cost_cents, expected_return_cents, scheduled_for, created_by, created_at.
- **campaign_recipients**: merchant_id, campaign_id, customer_id, arm, message_id null,
  created_at; unique(campaign_id, customer_id).
- **fraud_flags**: merchant_id, rule_key, severity (`low|medium|high`), entity_type,
  entity_id, detail jsonb, status (`open|dismissed|confirmed`), created_at, resolved_by, resolved_at.

---

## 6. Flows (the retention loop)

Each flow is a server-only file in `src/flows/` that opens a transaction where needed and
calls module repos/services and pure logic. These map 1:1 to the MVP steps.

| Flow file | Steps | What it does |
|---|---|---|
| `context.ts` | — | `FlowContext { merchantId, actor, now }`, blackout helper, public URLs |
| `onboarding.ts` | 1 | `createMerchantFromPreset` (menu with price + cost, programs, offers, experiment), `createOfferFromConfig` |
| `visits.ts` | 2, 12-13 | POS-lite: `openVisit`, `addItem`, `voidLine` (keeps the ledger consistent), `findCustomer`, `attachCustomer`, `createCustomerAtTill`, `visitView`, `applyCustomerPromo` |
| `checkout-offer.ts` | 3-5, 18 | `evaluateCheckoutOffer(db, ctx, visitId)`: basket, catalog, programs, customer snapshot, settings → `evaluateDeals()` → guardrails → holdout (eligible opportunities only) → **one** decision per visit (no reroll) → exposure if offered |
| `issue-anchor.ts` | 6 | `acceptOffer` → `anchor_upgrade` line + entitlement (`pending_claim` or `active`) + claim token; `declineOffer`; `keepStoredPurchase` (bottle/bucket/package keep) |
| `claim-anchor.ts` | 7-9 | `getClaimView`, `claimByToken` (rate-limited), `claimByStaff`: resolve/create customer, per-purpose consents, activate, wallet token, confirmation sent immediately |
| `messages.ts` | 9-11 | Outbox: `scheduleMessage`, `planAnchorMessages`, `chooseMessageOffer`, `dispatchDueMessages` / `sendMessageNow` through the send-time policy (guardrails kind `message`) |
| `scheduler.ts` | 10-11 | `runSchedulerTick(db, now)`: expire anchors and promos, plan win-back/bottle-low/renewal (once per anchor), dispatch, rescore stale customers, fraud scan, refresh measured uplift |
| `redemption.ts` | 14-16 | `redeemEntitlement` (row lock, ledger, premium upgrade difference, per-visit limit, receipt), `recordBottleLevel`, `getUpsellForVisit`, `addUpsell` |
| `close-visit.ts` | 17 | `closeVisit`: requires-new-purchase check, finalise, refresh aggregates + score, headline of what the visit earned |
| `campaigns.ts` | — | `suggestedCampaigns`, `launchCampaign` (holdout, per-recipient guardrails, messages) |
| `inbound-message.ts` | — | `handleInboundText` (STOP/START/BALANCE, idempotent), `handleStatusUpdate` |
| `pos-ingest.ts` | 2 (alt) | Canonical POS order → upsert visit + lines idempotently → optional offer evaluation |
| `scoring.ts` | — | Score features from stored facts, `customerSnapshot`, `refreshCustomer`, `rescoreStale` |
| `demo.ts` | — | Deterministic simulated history for the four demo merchants |

Console read models live in `src/modules/analytics/queries.ts`. See `src/flows/README.md`.

---|---|---|
| `checkout-offer.ts` | 2-5 | `evaluateCheckoutOffer(ctx, visitId)`: load basket, catalog, programs, customer snapshot, settings → `deals.evaluate()` → guardrails → experiment assignment → persist **one** decision per visit (no reroll) → exposure if offered |
| `issue-anchor.ts` | 6 | `acceptOffer` → add `anchor_upgrade` line + issue entitlement (`pending_claim` or `active` if customer known) + claim token; `declineOffer`; `keepStoredPurchase` (bottle keep) |
| `claim-anchor.ts` | 7-9 | `claimByToken(token, phone, consents)` and `claimByStaff(...)`: resolve/create customer, record consents, activate entitlement, create wallet token, schedule confirmation message |
| `scheduler.ts` | 10-11 | `runSchedulerTick(now)`: expire entitlements, plan reminders/expiry/win-back/bottle-low/renewal messages, dispatch due messages through send-time policy, rescore stale customers, run fraud scan |
| `redemption.ts` | 12-16 | `lookupByRedeemCode`, `redeemEntitlement` (row lock, ledger, redemption line, receipt message), `recordBottleLevel`, `getUpsellForVisit`, `addUpsellItem` |
| `close-visit.ts` | 17-18 | `closeVisit`: finalise, update customer aggregates, rescore, compute visit attribution summary, suggest next anchor (re-run checkout offer if no decision yet) |
| `campaign-launch.ts` | — | Build audience from suggestion, assign campaign holdout, schedule messages through policy |
| `inbound-message.ts` | — | Handle WhatsApp inbound: STOP/opt-out, BALANCE/WALLET reply, status updates |
| `pos-ingest.ts` | 2 (alt) | Canonical POS order → upsert visit + lines idempotently → optional offer evaluation |

---

## 7. Key algorithms (pure; see `docs/engines/*` for rationale)

### 7.1 Deal engine (`src/modules/deals`)
For each active `upgrade_offer` program whose trigger matches the basket:
1. Covered unit retail/cost: `items` coverage → max price/cost among listed active items;
   `category` coverage → `min(maxCoveredPriceCents ?? +∞, max price in category)` and the
   **highest cost** among eligible items at or below that price (conservative).
   `coveredRetail = units × unitRetail`, `coveredCost = units × unitCost` (= `C`).
2. Price ladder: for each rate in `settings.dealEngine.priceLadderRates` within
   `[pricing.minPriceRate, pricing.maxPriceRate]`, `U = roundUp(coveredRetail × rate, roundingCents)`.
3. Customer baseline return probability `p0` (Return Score computed **without** any
   anchor; unknown customer → merchant/vertical new-customer prior). Uplift prior
   `uplift = maxUplift × 4 × p0 × (1 − p0)` (persuadables in the middle gain most),
   `p1 = min(0.97, p0 + uplift)`. Overridable by measured lift.
4. `G` = expected gross profit of a normal visit (customer average if ≥ 2 visits, else
   merchant baseline). Substitution rate `s` (vertical default, merchant override).
   `Gnew = G − s × (coveredRetail − coveredCost) + upsellGpPrior`.
5. Expected incremental contribution if accepted:
   **`ΔE = U − C + p1 × Gnew − p0 × G − perkCost`** (no breakage credit: `C` counted in full).
6. Acceptance: `pAccept = baseAccept[segment] × sigmoid((depth − d0)/k)` where
   `depth = 1 − U / coveredRetail`.
7. Hard constraints per price point: `ΔE ≥ minExpectedContributionCents`;
   today margin `(basketRev + U − basketCost − C)/(basketRev + U) ≥ minTodayMarginRate`;
   `depth ≤ maxImpliedDiscountRate`; `perVisitCovered ≤ anchorValueCapRate × expectedNextVisitSpend`
   where `perVisitCovered = unitRetail × min(units, redemption.maxUnitsPerVisit)` — the anchor
   may pay for part of ONE return visit, never the whole of it (service verticals, where the
   session is the visit, raise the cap in their preset; see `docs/product/decisions.md`).
8. Pick the price point maximising `pAccept × ΔE`; rank programs by that value. Return all
   evaluated candidates with reasons (for the decision log) and the best one (or none).

### 7.2 Guardrails (`src/modules/guardrails`)
`evaluateGuardrails(input, settings, rules = GUARDRAIL_RULES) → { allowed, deferUntil, results[], blockedBy[] }`. One file per rule in
`rules/`, registered in `rules/index.ts`. Critical rules cannot be disabled. Initial rules:
`no-stacking`, `min-contribution`, `min-today-margin`, `max-discount-depth`,
`anchor-value-cap`, `cooldown-after-offer`, `promo-cost-cap`, `discount-frequency`,
`regulars-no-discount`, `price-sensitive-frequency`, `no-inactivity-escalation`,
`win-back-limit`, `vary-offer-type`, `max-active-anchors`, `liability-cap`,
`blackout-period`, plus messaging rules `consent-required`, `quiet-hours`,
`message-frequency-cap` (defers, never drops), `recently-visited`, `entitlement-still-active`.
Deferring rules (quiet hours, frequency caps) return `deferUntil`; the dispatcher reschedules.
Selection policy `prefer-non-discount`
lives in `offers/select.ts`.

### 7.3 Return Score (`src/modules/scoring`)
Logistic model over features (recency ratio vs typical gap, visits in 90 days, total visits,
tenure, avg spend percentile, party size, active entitlement value, days to expiry,
message response rate). `p = sigmoid(b0 + Σ wᵢ·fᵢ)`. Bands: `high ≥ 0.60`,
`medium ≥ 0.30`, else `at_risk`. Returns probability, 0-100 score, band and top factors.
Weights in `scoring/config.ts`.

### 7.4 Segments & playbooks (`src/modules/scoring`)
Priority: `high_value` → `likely_regular` → `price_sensitive` → `at_risk` → `persuadable`
→ `new` → `occasional`. Each segment maps to a playbook: allowed offer types, whether
discounts are permitted, preferred perks, message cadence. Next recommended action derives
from segment + entitlement state + cooldowns.

### 7.5 Upsell (`src/modules/upsell`)
Rank items by `complement(anchorCategory → itemCategory) × (0.6 + 0.4 × affinity) ×
gpWeight × partySizeBoost`, excluding items already on the visit; include bundle offer
definitions. Return top N with a staff script and expected GP.

### 7.6 Message timing (`src/modules/messaging`)
- Confirmation: immediately on claim (utility).
- Reminder 1: `clamp(typicalGap × reminderFraction, minDays, maxDays)` after issue, moved
  to the day before the customer's preferred weekday at the merchant's send hour when known.
- Expiry warning: `expiryWarningDays` before expiry. Win-back: once after `winBackAfterDays`
  of inactivity with an active anchor (non-discount perk preferred, never escalating).
- Bottle low (`percent ≤ 25`) and renewal (1 unit left) nudges.
- Send-time policy: consent, quiet hours (shift forward), per-customer marketing frequency
  cap, suppress if entitlement no longer active or customer visited recently.

### 7.7 Experiments & attribution (`src/modules/experiments`, `src/modules/analytics`)
- Assignment: `arm = hash(salt:unitType:unitId) < holdoutPct ? holdout : treatment`
  (deterministic; customer unit when identified at assignment, else visit unit).
- Primary causal metric: per identified assigned customer, contribution over horizon H
  (default 60 days) from assignment, treatment vs holdout, difference in means with Welch
  standard error and 90% CI; only matured assignments (older than H).
- Attributed (non-causal) metrics: redemptions, customers returning, stored value redeemed,
  new cash during redemption visits, GP of that new cash, new packages sold, attributable
  revenue, promotional cost, attributed contribution. Always labelled "attributed, not causal".

---

## 8. Settings (merchant-editable, JSON + Zod)

`src/modules/merchants/settings.ts` exports `merchantSettingsSchema` with defaults from
`src/config/defaults.ts` and vertical presets. Stored in `merchants.settings` as overrides;
always read through `parseSettings()`. Sections: `dealEngine`, `guardrails`, `experiment`,
`messaging`, `business` (booking URL, off-peak windows, blackouts), `anchors` (defaults).
Rates are fractions named `…Rate` (0.45 = 45%). The demo clock lives in `app_state`
(`src/server/clock.ts`).

---

## 9. Conventions

- **Naming**: kebab-case files, named exports, PascalCase types, `xxxSchema` for Zod.
  Default exports only where Next requires them (pages, layouts, route files).
- **Errors**: throw `AppError` subclasses from `@/core/errors` (`NotFoundError`,
  `ForbiddenError`, `ValidationError`, `ConflictError`, `RateLimitError`). Actions return
  `ActionResult<T>` (`{ ok: true, data } | { ok: false, error, fieldErrors? }`) via
  `runAction()` in `src/server/action.ts`; route handlers use `errorResponse()` from the same file.
- **Time**: pure functions take `now: Date`. Server code gets it from `getNow(db)` (demo clock
  aware); flows receive it as `ctx.now`.
- **Next.js 16**: see `docs/architecture/nextjs-16-conventions.md`.
- **Auth**: every server action, query and route calls `requireAuth(minRole)` (or verifies
  a token/API key) itself; layouts are not a security boundary.
- **Transactions**: flows wrap multi-write steps in `db.transaction`. Ledger changes lock
  the entitlement row (`for update`) and bump `version`.
- **Audit**: every state change to entitlements, settings, consents, API keys, campaigns
  writes `audit_log`.
- **Tests**: pure logic → co-located `*.test.ts`; flows → `tests/integration/*.test.ts`
  using `createTestDb()` (in-memory PGlite + migrations).
- **Comments**: explain *why* and business meaning; config values carry a one-line comment.
