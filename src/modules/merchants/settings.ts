/**
 * Merchant settings: defaults (`src/config/defaults.ts`) ← vertical preset ← merchant
 * overrides (stored in `merchants.settings`). Always read settings through
 * `parseSettings()`; never read the raw JSON column.
 */
import { z } from "zod";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import { logger } from "@/core/logger";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const rate = z.number().min(0).max(1);
const cents = z.number().int().min(0);
const weekday = z.number().int().min(0).max(6);

export const merchantSettingsSchema = z.object({
  dealEngine: z.object({
    enabled: z.boolean(),
    priceLadderRates: z.array(z.number().min(0.05).max(1)).min(1),
    roundingCents: z.number().int().min(1),
    maxUplift: z.number().min(0).max(0.6),
    maxReturnProbability: z.number().min(0.5).max(0.99),
    newCustomerReturnPrior: z.number().min(0.01).max(0.95),
    substitutionRate: rate,
    upsellGpPriorCents: cents,
    baseAcceptance: z.object({
      high_value: rate,
      likely_regular: rate,
      price_sensitive: rate,
      at_risk: rate,
      persuadable: rate,
      new: rate,
      occasional: rate,
    }),
    acceptanceMidpointDepth: rate,
    acceptanceSteepness: z.number().positive(),
    useMeasuredLift: z.boolean(),
    minMeasuredSamplesPerArm: z.number().int().min(5),
  }),
  guardrails: z.object({
    minExpectedContributionCents: cents,
    minTodayMarginRate: rate,
    maxImpliedDiscountRate: rate,
    anchorValueCapRate: z.number().min(0.05).max(2),
    offerCooldownDays: z.number().int().min(0),
    promoCostCapCents: cents,
    promoCostWindowDays: z.number().int().min(1),
    discountMinGapDays: z.number().int().min(0),
    priceSensitiveMaxOffers: z.number().int().min(0),
    priceSensitiveWindowDays: z.number().int().min(1),
    winBackMaxPerWindow: z.number().int().min(0),
    winBackWindowDays: z.number().int().min(1),
    maxActiveAnchors: z.number().int().min(1),
    liabilityCapCents: cents,
    disabledRules: z.array(z.string()),
  }),
  experiment: z.object({
    enabled: z.boolean(),
    holdoutRate: z.number().min(0).max(0.5),
    horizonDays: z.number().int().min(7).max(180),
  }),
  messaging: z.object({
    enabled: z.boolean(),
    sendHour: z.number().int().min(0).max(23),
    quietHoursStart: hhmm,
    quietHoursEnd: hhmm,
    reminderFraction: z.number().min(0.1).max(2),
    reminderMinDays: z.number().int().min(1),
    reminderMaxDays: z.number().int().min(1),
    expiryWarningDays: z.number().int().min(1),
    winBackAfterDays: z.number().int().min(7),
    bottleLowPercent: z.number().int().min(1).max(90),
    maxMarketingPer7Days: z.number().int().min(0),
    maxMarketingPer30Days: z.number().int().min(0),
    recentlyVisitedDays: z.number().int().min(0),
    utilityCostCents: cents,
    marketingCostCents: cents,
  }),
  business: z.object({
    bookingUrl: z.union([z.string().url(), z.literal("")]),
    offPeak: z.array(z.object({ weekdays: z.array(weekday), start: hhmm, end: hhmm })),
    blackouts: z.array(z.object({ start: isoDate, end: isoDate, reason: z.string() })),
  }),
  anchors: z.object({
    defaultValidityDays: z.number().int().min(1).max(730),
    claimWindowHours: z.number().int().min(1).max(24 * 30),
  }),
});

export type MerchantSettings = z.infer<typeof merchantSettingsSchema>;

/** Deep-partial shape used for presets and stored overrides. Arrays replace, not merge. */
export type SettingsOverrides = DeepPartial<MerchantSettings>;
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge: objects merge key by key, arrays and scalars replace. */
export function deepMerge<T>(base: T, ...layers: unknown[]): T {
  let result: unknown = base;
  for (const layer of layers) {
    if (layer === undefined || layer === null) continue;
    result = mergeTwo(result, layer);
  }
  return result as T;
}

function mergeTwo(base: unknown, layer: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(layer)) return layer === undefined ? base : structuredClone(layer);
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    if (value === undefined) continue;
    out[key] = key in base ? mergeTwo(base[key], value) : structuredClone(value);
  }
  return out;
}

/**
 * Build effective settings. Invalid overrides are ignored section by section (logged), so
 * a bad stored value never takes the merchant offline.
 */
export function parseSettings(overrides: unknown, presetOverrides?: SettingsOverrides): MerchantSettings {
  const base = deepMerge(structuredClone(DEFAULT_SETTINGS) as unknown as MerchantSettings, presetOverrides);
  const merged = deepMerge(base, isPlainObject(overrides) ? overrides : undefined);
  const parsed = merchantSettingsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;

  // Fall back per section: keep valid override sections, drop invalid ones.
  const result = { ...base } as Record<string, unknown>;
  const shape = merchantSettingsSchema.shape as Record<string, z.ZodType>;
  for (const key of Object.keys(shape)) {
    const candidate = (merged as Record<string, unknown>)[key];
    const section = shape[key]!.safeParse(candidate);
    if (section.success) result[key] = section.data;
    else logger.warn("Ignoring invalid merchant settings section", { section: key });
  }
  return merchantSettingsSchema.parse(result);
}

/**
 * Validate a settings patch from the console before saving it as an override. Returns
 * field errors keyed by dotted path ("guardrails.minTodayMarginRate").
 */
export function validateSettingsPatch(
  current: MerchantSettings,
  patch: SettingsOverrides,
): { ok: true; settings: MerchantSettings } | { ok: false; fieldErrors: Record<string, string> } {
  const merged = deepMerge(current, patch);
  const parsed = merchantSettingsSchema.safeParse(merged);
  if (parsed.success) return { ok: true, settings: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] = issue.message;
  return { ok: false, fieldErrors };
}
