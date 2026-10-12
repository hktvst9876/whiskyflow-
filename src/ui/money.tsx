import { formatMoney, formatRate, type Cents } from "@/core/money";
import { cn } from "./cn";

/** Currency + locale of the merchant; build it once per page from `auth.merchant`. */
export interface MoneyFormat {
  currency: string;
  locale: string;
}

export interface MoneyProps {
  /** Integer minor units (2250 = $22.50). */
  cents: Cents;
  /** Pass the merchant's format: `format={auth.merchant}` works (it has currency + locale). */
  format?: MoneyFormat;
  currency?: string;
  locale?: string;
  /** Drop ".00" on whole amounts ("$8"). Default true, as everywhere in the console. */
  compact?: boolean;
  /** Prefix positives with "+" (deltas, upgrade prices: "+$8"). */
  signed?: boolean;
  /** Colour positive green and negative red (contribution, lift). */
  colored?: boolean;
  className?: string;
}

/**
 * Formats cents with the merchant's currency and locale. Server-compatible and usable in
 * client components (it only depends on @/core/money).
 */
export function Money({ cents, format, currency, locale, compact = true, signed = false, colored = false, className }: MoneyProps) {
  const text = formatMoney(cents, { currency: currency ?? format?.currency, locale: locale ?? format?.locale, compact, signed });
  return (
    <span className={cn("numeric whitespace-nowrap", colored && cents > 0 && "text-success", colored && cents < 0 && "text-danger", className)}>{text}</span>
  );
}

/** A rate (0.42) as a percentage ("42%"). */
export function Percent({ rate, digits = 0, className }: { rate: number; digits?: number; className?: string }) {
  return <span className={cn("numeric whitespace-nowrap", className)}>{formatRate(rate, digits)}</span>;
}
