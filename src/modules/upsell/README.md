# upsell — next-visit recommendations (pure)

`recommendUpsell(input)` ranks items by `complement(anchorCategory → itemCategory) × (0.6 + 0.4·affinity) × gpWeight × partySizeBoost`, excludes what is already on the bill, mixes in merchant bundles, keeps variety (≤2 per category) and returns staff scripts with expected GP.

Complement maps live in each vertical preset (`src/verticals/*`). "Existing entitlement creates the visit; new spending creates the profit."
