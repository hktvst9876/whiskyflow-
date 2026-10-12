/**
 * Cross-module defaults for merchant settings. Vertical presets (`src/verticals`) and
 * each merchant's stored overrides are layered on top of these, then validated by
 * `merchantSettingsSchema` in `src/modules/merchants/settings.ts`.
 *
 * Money is in cents; rates are fractions (0.45 = 45%).
 */

export const DEFAULT_SETTINGS = {
  dealEngine: {
    enabled: true,
    // Prices tried for an upgrade, as a share of the covered retail value.
    priceLadderRates: [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6],
    // Round upgrade prices up to whole currency units ("+$9", not "+$8.40").
    roundingCents: 100,
    // Largest lift in return probability we assume an anchor can cause (persuadables).
    maxUplift: 0.2,
    // Probability cap after adding uplift.
    maxReturnProbability: 0.97,
    // Return probability assumed for a customer we know nothing about.
    newCustomerReturnPrior: 0.25,
    // Share of the anchored item's margin the customer would have bought anyway next time.
    substitutionRate: 0.35,
    // Expected extra gross profit from upsell on the redemption visit.
    upsellGpPriorCents: 500,
    // Base chance a customer accepts a fair upgrade, by segment.
    baseAcceptance: {
      high_value: 0.3,
      likely_regular: 0.3,
      price_sensitive: 0.5,
      at_risk: 0.35,
      persuadable: 0.4,
      new: 0.35,
      occasional: 0.35,
    },
    // Implied discount depth at which acceptance is half of the base rate.
    acceptanceMidpointDepth: 0.5,
    // How quickly acceptance rises with a deeper implied discount.
    acceptanceSteepness: 0.12,
    // Replace the uplift prior with the measured holdout lift once enough data matures.
    useMeasuredLift: true,
    // Matured customers needed per arm before the measured lift is trusted.
    minMeasuredSamplesPerArm: 30,
  },
  guardrails: {
    // Expected incremental contribution an offer must clear.
    minExpectedContributionCents: 300,
    // Margin on today's bill after counting the stored item's full cost (no breakage).
    minTodayMarginRate: 0.45,
    // Deepest implied discount allowed: 1 − price paid / covered retail value.
    maxImpliedDiscountRate: 0.7,
    // Covered value must stay below this share of the expected next-visit spend.
    anchorValueCapRate: 0.6,
    // Days after an offer is shown before the same customer can see another.
    offerCooldownDays: 14,
    // Promotional cost allowed per customer within the window below.
    promoCostCapCents: 1500,
    promoCostWindowDays: 90,
    // Minimum days between two discount-type offers to one customer.
    discountMinGapDays: 60,
    // Offers a price-sensitive customer can receive within the window below.
    priceSensitiveMaxOffers: 2,
    priceSensitiveWindowDays: 90,
    // Win-back offers per customer within the window below.
    winBackMaxPerWindow: 1,
    winBackWindowDays: 90,
    // Active anchors one customer may hold at once.
    maxActiveAnchors: 2,
    // Ceiling on the retail value of all outstanding anchors for the merchant.
    liabilityCapCents: 1_500_000,
    // Non-critical rule keys switched off by the merchant.
    disabledRules: [] as string[],
  },
  experiment: {
    enabled: true,
    // Share of eligible opportunities held out (no offer) to measure true lift.
    holdoutRate: 0.2,
    // Days after assignment over which customer contribution is compared.
    horizonDays: 60,
  },
  messaging: {
    enabled: true,
    // Local hour at which reminders are sent.
    sendHour: 17,
    // No messages between these local times; due messages wait until the window ends.
    quietHoursStart: "21:00",
    quietHoursEnd: "09:00",
    // First reminder after this share of the customer's typical gap between visits.
    reminderFraction: 0.6,
    reminderMinDays: 4,
    reminderMaxDays: 14,
    // Expiry warning this many days before an anchor expires.
    expiryWarningDays: 7,
    // Win-back message after this many days without a visit while an anchor is active.
    winBackAfterDays: 30,
    // "Bottle almost finished" nudge at or below this level.
    bottleLowPercent: 25,
    // Marketing messages per customer per 7 and 30 days.
    maxMarketingPer7Days: 1,
    maxMarketingPer30Days: 3,
    // Skip reminders when the customer visited within this many days.
    recentlyVisitedDays: 3,
    // Approximate provider cost per message (WhatsApp conversation pricing).
    utilityCostCents: 2,
    marketingCostCents: 8,
  },
  business: {
    bookingUrl: "",
    // Off-peak windows (local time); weekdays 0 = Sunday.
    offPeak: [{ weekdays: [1, 2, 3, 4], start: "14:00", end: "18:00" }] as { weekdays: number[]; start: string; end: string }[],
    // Dates (YYYY-MM-DD, inclusive) when no new offers are made, e.g. festive peaks.
    blackouts: [] as { start: string; end: string; reason: string }[],
  },
  anchors: {
    defaultValidityDays: 60,
    // How long the claim QR stays valid after the anchor is created.
    claimWindowHours: 72,
  },
} as const;

export type DefaultSettings = typeof DEFAULT_SETTINGS;
