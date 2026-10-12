# analytics — attribution, lift and dashboard read models

- `attribution.ts` (pure): the brief §11 block — **attributed, not causal**.
- `lift.ts` (pure): treatment vs holdout contribution per customer with Welch SE and 90% CI; `measuredUplift` (shrunk) feeds the deal engine.
- `queries.ts` (server): `todayOverview`, `revenueOpportunities`, `customerList`, `customerDetail`, `offerPerformance`, `campaignPerformance`, `attributionForPeriod`, `liftReport`.

Rule: every money number is computed from visit lines and the ledger. Never present redemptions or prepaid value as profit.
