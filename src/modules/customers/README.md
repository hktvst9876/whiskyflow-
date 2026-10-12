# customers — identity, consent, wallet links

**Owns:** `customers` (per merchant; phone, redeem code, aggregates, score), `customer_consents` (append-only, per purpose with notice version), `wallet_tokens`.

**Public API:** `computeAggregates` (pure); server `repo.ts` (find by phone/code, insert with unique redeem code, `recordConsent`, `walletTokenFor`, `anonymiseCustomer`).

Privacy: anonymising removes phone/name and revokes wallet links but keeps anonymous visit facts for reporting. Consent wording version: `CONSENT_NOTICE_VERSION` in `config.ts` (bump when the claim-page wording changes).
