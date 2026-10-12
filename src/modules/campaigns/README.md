# campaigns — segment campaigns with a holdout

**Owns:** `campaigns`, `campaign_recipients` (arm per recipient).

**Public API:** `suggestCampaigns`, `audienceFor` (`suggest.ts`, pure; recipes prefer non-discount offers and estimate cost/return up front). Launch and performance: `src/flows/campaigns.ts`, `campaignPerformance` in `analytics/queries.ts`. Every launch keeps a holdout.
