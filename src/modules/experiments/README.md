# experiments — randomised holdouts

**Owns:** `experiments`, `experiment_assignments`.

**Public API:** `assignArm(salt, unitType, unitId, holdoutRate)` (deterministic hash), `assignmentUnit(visitId, customerId)`; server: `ensureExperiment`, `assignUnit` (first assignment wins forever), `maturedCustomerAssignments`, `allAssignments`.

The checkout experiment (`checkout_anchor`) assigns only **eligible** opportunities (an offer would have been shown), so treatment vs holdout answers "did offering anchors make customers more valuable?". Lift maths lives in `analytics/lift.ts`.
