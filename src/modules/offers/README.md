# offers — offer types, decisions and exposures

**Owns:** `offer_definitions` (merchant offers/perks), `offer_decisions` (one checkout decision per visit, never re-rolled), `offer_exposures` (every offer shown, by channel, with its outcome and promo cost).

**Public API:** `OFFER_KINDS` / `offerKind(key)` (`kinds/*`: config schema, `isDiscount`, `promoCostCents`, `customerLine`, `applyToBill`), `selectOffer` (prefer non-discount perks, vary type, cheapest).

**How to change**
- New offer type: add a file in `kinds/`, its key to `OFFER_TYPE_KEYS`, register it, then allow it in the relevant playbooks (`scoring/playbooks.ts`).
- `is_discount`/`est_cost_cents` are recomputed from the kind on create/edit — never trust stale values.
