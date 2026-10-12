# scoring — Return Score, segments, playbooks

**Public API:** `computeReturnScore(features)` (logistic; weights in `config.ts`), `baselineFeatures` (same customer without anchors → p0 for the deal engine), `segmentFor`, `PLAYBOOKS`, `nextRecommendedAction`, `percentileRank`.

Features are built from stored facts in `src/flows/scoring.ts` (`buildScoreFeatures`); scores and segments are saved on `customers` by `rescoreCustomer`.

**How to change:** weights/bands/segment thresholds → `config.ts`; what each segment may receive → `playbooks.ts`. Refit weights per merchant only once enough history exists (see `docs/engines/return-score-segments-upsell.md`).
