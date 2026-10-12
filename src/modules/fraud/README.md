# fraud — anomaly rules

`rules.ts` (pure): rapid redemption by the issuing staff member, unusual staff redemption volume, many claims per customer, upgrade voided after issue, manual positive adjustments. `repo.ts` gathers facts and stores flags for human review (never automatic punishment). The scheduler runs the scan every tick.
