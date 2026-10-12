# TablePulse customer recognition and offer decision design

Prepared 8 October 2026. This document describes the broader customer recognition and recommendation design. The implementation update below identifies the parts now included in the MVP.

Implementation update, 9 October 2026: customer OTP/member accounts, staff-confirmed check-in, persistent per-visit reward opportunities, venue-scoped active-reward reservation checks, a 30% default incremental-margin floor and an optional constrained AI offer ranker have now been added. Live SMS and live model calls still need provider configuration. Purchase-feature learning, POS bill lineage, automatic account merges, cross-venue caps and bandit policies remain proposed work. The sections below describe the broader target design; see README for the implemented workflow and limitations.

## Recommended approach

Use Supabase phone OTP to authenticate a customer on their own phone, a permanent internal customer UUID to join records, and a separate random membership number for human-friendly identification. Keep the existing POS reference as a mapped identity. Use the backend rules to authorize rewards, and a constrained recommendation service to rank the remaining approved options, including `NO_OFFER`.

Phone possession is not proof of a unique person, adulthood or ownership of every item on a table bill. Multiple numbers, shared accounts and recycled numbers remain possible. Do not collect NRIC or covertly fingerprint guests to solve this. Control exposure through verification, POS bill integrity, reservations, caps, anomaly review and small campaign budgets.

Customers who decline recognition can still order and see menu highlights. Personalised subsidised rewards remain fail-closed without verified identity under the current live policy.

## What exists and what needs changing

Current code provides basket rules, weighted scoring, POS-reference pseudonymization, one allocated offer per session, 30-day redeemed-reward caps, 60-day promotion-history checks, service-only transactions, redemption checks and audit logs. `customers` currently holds opt-in, category preferences and an entitlement flag, not a full account or learned profile. Purchase data is linked to visits; attribution and profile aggregation need to be designed before treating those records as personal consumption.

Two important improvements precede learning:

1. `evaluate()` currently draws fresh random values on eligible calls and records `offerReceived` only after allocating an offer. A customer can potentially split organic orders to obtain repeated allocation attempts. Assign one persistent opportunity to the genuine POS visit and consume it on the first meaningful eligible basket, whether the outcome is offer, control or no offer. Replay and later basket changes must not reroll it.
2. Reserve customer subsidy eligibility when allocating a reward, not only when redeeming. Otherwise one account can hold pending rewards at multiple tables, even though final redemption checks protect the redeemed cap. Make reservation and allocation atomic under the customer lock.

This MVP's snapshot/commit repository also needs extension when adding tables. New records must participate in transactional writes, snapshot reads, RLS and tests; adding SQL tables alone is insufficient.

## Customer journey

1. Customer scans the table QR and chooses optional recognition. Registration and OTP entry happen on the customer's personal phone, never the shared table display.
2. Supabase verifies the phone with an SMS provider. Normalize numbers to E.164. Add resend/verification rate limits, bot protection, provider spend limits and account-enumeration protection.
3. The backend resolves an immutable `customer_id`. A random, unique membership number is a lookup reference, not a password or redemption credential. Do not create a reward merely for registration.
4. Separate purpose choices: participation/recognition, history-based personalisation and optional outbound marketing. Store notice version, purpose, timestamp and withdrawal. Define operational reward-abuse processing separately and document it.
5. A short-lived signed check-in request binds the authenticated account to the current table. Require staff/POS confirmation to prevent someone using a photographed table QR to attach to another party. A public display token alone is not enough evidence of table ownership.
6. Freeze the nominated subsidy recipient for that visit. Map POS loyalty references to the same customer ID. Phone changes, verified account merges and recovery preserve reward history and cooldowns.
7. On later visits the customer signs in or presents a securely authenticated member check-in. Membership number entry alone must not expose their history or claim their benefits.

Keep the identity UUID stable when a phone changes. Do not regenerate identity by hashing the current phone number. Retain phone details in the protected authentication system where possible, avoid copies in transaction logs, and never send them to a recommendation model.

## A visit is not just a table-session ID

Use the venue and external POS bill ID as the trusted visit anchor. Table moves, split/merged bills and reopen events must map to the same opportunity lineage where they represent the same visit. Genuine new visits need POS lifecycle evidence, not a guest page refresh or a staff session reset alone. Audit resets and overrides.

Late identity linking is a policy choice: if linking after an order is supported, trigger at most one evaluation against the already placed organic bill; registration cannot grant a new random chance. If an opportunity was already consumed, linking a different account does not reset it.

## The decision pipeline

### 1. Build a minimal context

- Current non-voided organic basket, total and approved campaign matches.
- Account identity assurance, consent, subsidy cooldowns and pending reservations.
- Aggregate purchase tendencies from attributed organic orders; unknown when evidence is sparse.
- Recent promotion exposures, declines/expiries and redemption outcomes.
- Current item costs, stock, daily allocation and venue policy version.
- Current staff-confirmed alcohol safety flags. Phone verification and historical alcohol orders do not establish age or present sobriety.

Do not attribute a whole shared-table bill to an individual's tastes. In V1 track it as an associated visit/bill; preferences inferred from it are weak evidence. Add guest-specific POS line attribution later if the provider supports it. Respect explicit customer preferences, but treat allergies as separately verified information rather than inferred from order history.

### 2. Apply hard rules before recommendation

- Qualifying organic order exists; selected items remain on the current bill.
- Trusted open visit; no prior opportunity consumption or prior offer allocation.
- Verified nominated recipient; customer not within the 30-day subsidy cap and no other active reservation.
- No repeat promotion to that customer within 60 days. Use a stable promotion family ID so campaign renaming cannot bypass the rule.
- No stacking, blocked table, venue pause or unsafe alcohol promotion.
- Stock and actual daily allocation available; approved price and quantities; projected sale GP exceeds the venue floor.
- Redemption is original visit/current bill only. Registration, waiting and screen refresh are not offer triggers.

Persist reasons for both passes and failures. Mandatory rules must remain in application code and SQL constraints/transaction checks where possible, outside any AI model.

### 3. Create only approved incremental options

Offer candidates come from venue-approved campaigns and prices, not generated discounts. Exclude targets already ordered and obvious substitutes for an imminent full-price purchase. Include `NO_OFFER` as a legitimate action. Non-discounted recommendations can be a separate, lower-risk product feature.

### 4. Rank for incremental gross profit

For the first release, keep explainable rules and use purchase history conservatively: basket complementarity, profit, availability, explicit preference and organic-purchase propensity. A frequently purchased favourite may be the worst item to discount. Limited observations should fall back to basket/cohort rules rather than pretend individual certainty.

The later economic target is approximately:

`expected uplift = P(purchase | offer, context) * GP_at_offer_price - P(purchase | no offer, context) * GP_at_regular_price - added variable costs`

This is a simplified item-level target. Full bill-level effects, substitutions, displaced purchases, returns, taxes and service charges can change the result. Do not subtract discount again if it is already reflected in the offer price. Distinguish conditional GP on a redeemed sale (existing engine) from expected incremental uplift (proposed model).

Historical conversion alone cannot establish either counterfactual. Use randomised controls among eligible visits to estimate differences. Organic demand and discounted demand must be logged separately to avoid training the system to reward discount seekers.

### 5. Persist one opportunity, then commit

An opportunity is consumed only once the agreed qualifying basket exists, never on an empty bill. Persist control/allocation assignment with a versioned policy. Keep it stable for the visit; optionally make subsidy exploration availability stable per customer for a configurable window to reduce repeated-visit farming. That restriction is a proposed policy, not the current 30-day redeemed cap.

The recommendation service returns an approved offer ID or `NO_OFFER`, never arbitrary prices or redemption permission. Validate its response, recheck current guardrails and commit the choice, reservation and allocation atomically. After consumption, depleted stock, model failure or cancellation does not create a fresh opportunity. A model timeout can use a precommitted conservative rules choice or no offer, with a logged reason.

Illustrative orchestration (not executable implementation):

```text
on genuine new organic POS event:
    deduplicate event and resolve trusted visit
    construct context and check identity / bill / caps / safety
    derive approved incremental candidates
    if no meaningful basket: log and wait for a genuine basket change
    if opportunity already consumed: return prior outcome
    persist one opportunity and stable control/allocation assignment
    if control, allocation withheld or no safe candidate: choose NO_OFFER
    else rank approved candidates with configured policy
    recheck stock, margins, customer reservation and daily cap
    atomically commit outcome / reservation / offer / audit

on authenticated staff redemption:
    verify original visit, code, expiry and remaining qualifying items
    recheck identity, caps, stock, margin and safety
    atomically record purchase and redemption, consume stock
    turn customer reservation into reward history
    reconcile redeemed bill line with external POS
```

## What the 'agent' should be

Start with a TypeScript `RecommendationPolicy` interface that receives minimal context and approved candidates. Provide an explainable rules implementation first. Add a learned policy behind the same interface when experiment data supports it.

A future contextual bandit can use limited, budgeted exploration to learn which safe action works in which basket context. Thompson sampling or another evaluated contextual policy is a possible next-stage choice, not a guarantee of causal uplift. Exploration occurs only inside the eligible action set. Keep a separately randomised, stable no-offer holdout and log action-selection probabilities and policy version. Do not replace causal validation with bandit conversion metrics.

The implemented optional language-model ranker receives approved candidate IDs and coarse context. It cannot change prices, safety flags, profit goals, caps, stock, customer identity, session bindings or redemption. It receives no raw phone number, name, customer ID or complete history. Unapproved output is rejected and the deterministic scorer is used. Candidate labels and raw POS notes are excluded from the model input so untrusted content cannot act as instructions.

Suggested model output contract:

```json
{
  "action": "offer_or_none",
  "offerId": "approved-id-or-null",
  "reasonCode": "APPROVED_REASON_CODE",
  "policyVersion": "configured-policy-version"
}
```

The database writer takes its action from validated server logic, never directly from model prose.

## Proposed data extensions

Names below are design suggestions, not already created tables.

| Record                         | Purpose                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Extend `customers`             | Immutable UUID, auth-user mapping, random membership ID, state and recovery metadata.                                  |
| `customer_identities`          | Verified POS/provider references mapped to one customer; provenance, uniqueness and audit.                             |
| Extend `customer_consents`     | Separate purpose/version/timestamps; current grants and withdrawal history.                                            |
| `customer_session_links`       | Confirmed customer-to-visit association, nominated recipient, actor and attribution confidence.                        |
| `customer_purchase_features`   | Rebuildable aggregates of attributed organic behaviour with counts and last-updated time.                              |
| `decision_opportunities`       | One persistent opportunity per trusted visit lineage; assignment, attempted/consumed outcome and policy version.       |
| `customer_reward_reservations` | At most one active subsidy reservation per customer at the agreed venue/platform scope.                                |
| `recommendation_exposures`     | Candidate set, chosen action, features/version, selection probability, assignment, delivery acknowledgment and expiry. |
| `recommendation_outcomes`      | Linked completed bills, redemptions, organic target purchases, voids and corrections.                                  |

Keep policy exposure distinct from confirmed device display. If a screen was offline, an allocation is not proof a guest saw the offer. Do not treat expiry or non-redemption as dislike without this context.

Customer history must be scoped to the venue or an explicitly chosen venue group. V1 operates one venue per deployment. Cross-venue identity/caps require a shared identity and reservation service; separate deployments do not enforce a platform-wide cap automatically.

## Anti-abuse tests

| Attempt                                      | Expected defence                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Refresh screen or resend identical POS event | Same recorded outcome; no new draw or order.                                                                                    |
| Split qualifying order into repeated events  | One consumed opportunity for the visit.                                                                                         |
| Move tables, split bill or reopen visit      | Preserve opportunity lineage through trusted POS mapping.                                                                       |
| Register/change phone after withholding      | Same visit outcome; existing account history survives authorised changes.                                                       |
| Link one account to multiple tables          | Customer reservation/lock permits at most one active subsidy at the selected scope.                                             |
| Use a friend's membership number             | Number is lookup only; authenticated check-in plus staff/POS confirmation required.                                             |
| Screenshot reward or forward QR              | Original bill/session plus authenticated staff redemption required; shared identity alone is insufficient.                      |
| Void mains after unlocking                   | Cancel pending reward; redemption rechecks; external POS refund corrections reconciled.                                         |
| Rename campaign to dodge repeat cap          | Same promotion-family history remains capped.                                                                                   |
| Staff repeatedly overrides or resets         | Hard checks remain; opportunities cannot be reset; log and review staff patterns.                                               |
| Flood OTP requests                           | Rate limits, bot checks and provider spend controls; keep error responses non-enumerating.                                      |
| Several real people/accounts collude         | No perfect identity proof; enforce table/bill controls and bounded subsidy budgets, route suspicious evidence for human review. |

Anomaly signals should create a review case, not automatically label a customer fraudulent. Shared venue Wi-Fi or a shared device is weak evidence and cannot by itself justify rejection.

## Rollout and measurement

1. Harden opportunity persistence, trusted bill mapping and atomic customer reservations. Run adversarial replay/concurrency tests.
2. Add phone/member accounts, check-in, recovery, POS identity mapping and consent. Requires a hosted Supabase project and an SMS provider.
3. Add purchase-attribution rules, profile aggregates and an explainable ranking policy. Do not discount frequent organic purchases just because they are favourites.
4. Log completed bill outcomes, actual display delivery and randomised controls. Track incremental GP, discount leakage, staff intervention and abuse loss.
5. Validate a predictive/bandit policy offline, run in shadow mode, then a limited, monitored experiment with rollback. Preserve all hard controls and no-offer options.

No fixed sample count guarantees readiness. It depends on traffic, effect size, variance and the number of campaign/cohort comparisons. Aggregate first; sparse customer histories should not create elaborate personal models.

## Privacy and operational boundaries

Explain recognition and history use to customers, record the selected lawful processing approach/consents, allow opt-out, restrict staff access and adopt a documented retention/deletion policy. Personalisation withdrawal stops profile use promptly; any retained abuse/audit records need a justified, disclosed retention purpose. Do not assume pseudonymization makes these records anonymous.

Separate account-service OTP from promotional SMS/WhatsApp. Before outbound marketing, assess consent and applicable Singapore Do Not Call requirements. A general rewards opt-in does not automatically authorize every marketing channel. Configure supplier access, regional hosting and transfer safeguards before sending customer data to an external model.

## Primary references

- Supabase phone sign-in and SMS-provider requirements: https://supabase.com/docs/guides/auth/phone-login
- Supabase authentication rate limits: https://supabase.com/docs/guides/auth/rate-limits
- PDPC key concepts (consent, purposes, protection and retention): https://www.pdpc.gov.sg/guidelines-and-consultation/2020/03/advisory-guidelines-on-key-concepts-in-the-personal-data-protection-act
- PDPC marketing consent guidance: https://www.pdpc.gov.sg/guidelines-and-consultation/2020/02/advisory-guidelines-on-requiring-consent-for-marketing-purposes
- Contextual bandit research, a technique reference rather than a restaurant uplift claim: https://arxiv.org/abs/1003.0146

Source grounding: `lib/engine.ts`, `lib/advisor-core.ts`, `lib/server/offer-agent.ts`, `lib/server/commands.ts`, `lib/server/store.ts` and `README.md` in this repository.
