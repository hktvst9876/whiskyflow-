# Flows — the retention loop

Cross-module use-cases. Each function takes `(db, ctx: FlowContext, …)` where
`FlowContext = { merchantId, actor, now }` (`./context.ts`). Server actions build it with
`withAuth()` from `src/server/action.ts`; the demo simulation passes a simulated `now`.
Flows never import `next/*`, so they run in tests and scripts unchanged.

| Brief §17 step | Function | File |
|---|---|---|
| 1 Merchant enters menu + prices + costs | `createMerchantFromPreset`, `createOfferFromConfig`, `programInputFromPreset` | `onboarding.ts` |
| 2 Customer orders normally | `openVisit`, `addItem`, `setPartySize`, `voidLine` (POS-lite) · `ingestPosOrder` (POS API) | `visits.ts`, `pos-ingest.ts` |
| 3-5 Analyse basket → profitable upgrade → staff see "Offer +$8 → 1 Main Waiting" | `evaluateCheckoutOffer` (one decision per visit, guardrails, holdout) · `getCheckoutOffer` | `checkout-offer.ts` |
| 6 Customer accepts | `acceptOffer`, `declineOffer` · bottle/bucket/package keep: `keepStoredPurchase` | `issue-anchor.ts` |
| 7-9 Scan QR → wallet → WhatsApp confirmation | `getClaimView`, `claimByToken`, `claimByStaff` | `claim-anchor.ts` |
| 10-11 Wait for the right moment → reminder | `runSchedulerTick` (expiry, nudges, dispatch, rescoring, fraud, measured uplift) · `planAnchorMessages`, `dispatchDueMessages`, `sendMessageNow`, `chooseMessageOffer` | `scheduler.ts`, `messages.ts` |
| 12-13 Customer returns; staff scan their QR | `findCustomer`, `attachCustomer`, `createCustomerAtTill`, `visitView` | `visits.ts` |
| 14 Redeem | `redeemEntitlement` (units, premium upgrade, per-visit limit) · `recordBottleLevel` | `redemption.ts` |
| 15-16 Add-ons → new purchase | `getUpsellForVisit`, `addUpsell` · WhatsApp promos at the till: `applyCustomerPromo` | `redemption.ts`, `visits.ts` |
| 17 Incremental revenue | `closeVisit` (totals + headline) · reports: `attributionForPeriod`, `liftReport` (`@/modules/analytics/queries`) | `close-visit.ts` |
| 18 Another anchor? | `evaluateCheckoutOffer` runs on every bill, including redemption visits; guardrails decide | `checkout-offer.ts` |

Other flows: `suggestedCampaigns` / `launchCampaign` (campaigns with holdout,
`campaigns.ts`), `handleInboundText` / `handleStatusUpdate` (WhatsApp STOP/START/BALANCE and
delivery receipts, `inbound-message.ts`), `customerSnapshot` / `refreshCustomer` /
`rescoreStale` (Return Score + segment, `scoring.ts`), `seedDemo` (simulated demo history,
`demo.ts`).

Read models for the console live in `src/modules/analytics/queries.ts`: `todayOverview`,
`revenueOpportunities`, `customerList`, `customerDetail`, `offerPerformance`,
`campaignPerformance`, `attributionForPeriod`, `liftReport`.

## Rules
- Multi-write steps run in `inTransaction(db, tx => …)` and use **only `tx`** inside (PGlite
  serialises one connection; touching the outer `db` inside a transaction deadlocks).
- Ledger changes lock the entitlement row (`forUpdate`) and go through `applyLedgerChange`.
- Messages are planned, then sent through the send-time policy (guardrails kind `message`);
  confirmations and receipts use `sendMessageNow`.
- Every number shown to a merchant comes from visit lines and the ledger; attributed metrics
  are labelled "attributed, not causal"; the holdout lift is the causal answer.
