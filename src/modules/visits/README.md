# visits — bills and lines

**Owns:** `visits`, `visit_lines`. Line types: `regular` (new cash), `anchor_upgrade` (the +$X), `anchor_redemption` (price 0, cost of what was used), `perk` (price 0, cost > 0), `discount` (negative price).

**Public API:** `computeTotals` (pure; new cash vs upgrades vs redemptions vs perks/discounts); server `repo.ts`. POS-lite and close-visit logic are flows (`src/flows/visits.ts`, `close-visit.ts`).
