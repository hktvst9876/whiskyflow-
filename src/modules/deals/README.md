# deals — dynamic deal engine (pure)

Answers: *what small extra payment today creates meaningful unfinished value for the next visit — profitably?*

**Public API:** `evaluateDeals(input, currency?, locale?) → { best, candidates }`, plus `coveredUnit`, `triggerFailures`, `priceLadder`, `upliftPrior`, `DEAL_POLICY_VERSION`.

**Economics** (blueprint §7.1): `ΔE = U − C + p1·Gnew − p0·G − perkCost`, no breakage credit; acceptance `pAccept = base[segment] · sigmoid((depth − d0)/k)`; hard constraints: min ΔE, min today margin, max implied discount, and the per-visit anchor value cap (`unitRetail × min(units, maxUnitsPerVisit) ≤ anchorValueCapRate × expected next-visit spend`).

**How to change**
- Numbers (ladder, priors, acceptance curve) → `src/config/defaults.ts` (`dealEngine`), per vertical in `src/verticals/*`, per merchant in settings.
- Logic changes → bump `DEAL_POLICY_VERSION` (stored on every decision for analysis) and update `engine.test.ts`.
