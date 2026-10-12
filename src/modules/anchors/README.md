# anchors — Return Anchors and their ledger

**Owns:** `anchor_programs` (merchant rules), `entitlements` (what a customer owns), `entitlement_events` (append-only ledger).

**Public API** (`index.ts`, pure): types; `entitlementLabel`/`entitlementHeadline`/`coverageText` (customer wording — tangible units, never money); `applyRedeem`, `applyLevel`, `applyAdjust`, `applyExpire`, `applyVoid`, `applyRefund`, `refundAllowed`, `checkRedemptionRules`, `redemptionCostCents`, `remainingRetailCents` (`ledger.ts`); `buildTermsSnapshot`, `transparencyLines` (`terms.ts`).
**Server:** `repo.ts` (programs, entitlements, events, liability), `service.ts` (the only writer: `issueEntitlement`, `applyLedgerChange`, `claimEntitlementRow`, `reopenClaimWindow`).

**Invariants**
- `quantity_after = previous + delta`, never negative, never above `quantity_initial`.
- Callers lock the row (`getEntitlement(…, { forUpdate: true })`) inside a transaction; `version` is re-checked on update.
- Terms are frozen at issue (`terms_snapshot`); editing a program never changes what a customer bought.
- Stored purchases (bottle/bucket/package keep) cost nothing at redemption — they were expensed when sold.

**How to change**
- Customer wording → `labels.ts`. Wallet rule lines → `terms.ts`.
- A new redemption restriction → add it to `AnchorRedemptionRules` (`types.ts`), enforce in `checkRedemptionRules` or the redemption flow, and show it in `transparencyLines`.
