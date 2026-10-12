/**
 * Money helpers. All money is stored and computed as integer minor units ("cents"),
 * e.g. S$22.50 → 2250. Never store or compare floating-point currency amounts.
 *
 * Rates (margins, discounts, probabilities) are fractions between 0 and 1 and are
 * named `...Rate` in code and settings (0.35 = 35%).
 */

export type Cents = number;

/** Convert a major-unit amount (22.5) to cents (2250), rounding half away from zero. */
export function toCents(amount: number): Cents {
  return Math.round(amount * 100);
}

/** Convert cents to a major-unit number (2250 → 22.5). For display/CSV only. */
export function fromCents(cents: Cents): number {
  return cents / 100;
}

/** Sum a list of cent amounts. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Multiply cents by a rate and round to the nearest cent. */
export function applyRate(cents: Cents, rate: number): Cents {
  return Math.round(cents * rate);
}

/** Round up to the next multiple of `step` cents (e.g. step 100 → whole currency units). */
export function roundUpTo(cents: Cents, step: Cents): Cents {
  if (step <= 1) return Math.ceil(cents);
  return Math.ceil(cents / step) * step;
}

/** Round to the nearest multiple of `step` cents. */
export function roundTo(cents: Cents, step: Cents): Cents {
  if (step <= 1) return Math.round(cents);
  return Math.round(cents / step) * step;
}

/** Gross margin as a rate: (revenue − cost) / revenue. Returns 0 when revenue is 0. */
export function marginRate(revenueCents: Cents, costCents: Cents): number {
  if (revenueCents <= 0) return 0;
  return (revenueCents - costCents) / revenueCents;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, locale: string, showCents: boolean) {
  const key = `${currency}|${locale}|${showCents}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: showCents ? 2 : 0,
      maximumFractionDigits: showCents ? 2 : 0,
    });
    formatterCache.set(key, f);
  }
  return f;
}

export interface MoneyFormatOptions {
  currency?: string;
  locale?: string;
  /** Show cents. Defaults to true unless the amount is a whole number and `compact` is set. */
  showCents?: boolean;
  /** Drop ".00" on whole amounts (e.g. "$8" instead of "$8.00"). */
  compact?: boolean;
  /** Prefix positive values with "+" (useful for deltas such as "+$8"). */
  signed?: boolean;
}

/** Format cents for display, e.g. formatMoney(2250, { currency: "SGD" }) → "$22.50". */
export function formatMoney(cents: Cents, options: MoneyFormatOptions = {}): string {
  const { currency = "SGD", locale = "en-SG", compact = false, signed = false } = options;
  const whole = cents % 100 === 0;
  const showCents = options.showCents ?? !(compact && whole);
  const text = moneyFormatter(currency, locale, showCents).format(cents / 100);
  return signed && cents > 0 ? `+${text}` : text;
}

/** Format a rate (0.42) as a percentage string ("42%"). */
export function formatRate(rate: number, digits = 0): string {
  return `${(rate * 100).toFixed(digits)}%`;
}
