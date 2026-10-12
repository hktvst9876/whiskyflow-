/**
 * Customer-facing wording for Return Anchors. Customers see what they OWN
 * ("1 Main Waiting", "Macallan 12 · 42% remaining"), never a monetary credit.
 */
import { formatMoney } from "@/core/money";
import type { AnchorCoverage, AnchorUnitType } from "./types";

export interface LabelSource {
  unitType: AnchorUnitType;
  quantityRemaining: number;
  unitLabel: string;
  unitLabelPlural: string;
  displayName: string;
}

/** "1 main", "2 pints", "42%". */
export function quantityText(unitType: AnchorUnitType, quantity: number, unitLabel: string, unitLabelPlural: string): string {
  if (unitType === "percent") return `${quantity}%`;
  return `${quantity} ${quantity === 1 ? unitLabel.toLowerCase() : unitLabelPlural.toLowerCase()}`;
}

/**
 * The one-line label used on wallets, staff screens and messages:
 * item/session → "1 Main Waiting", "3 Pints Remaining"; percent → "Macallan 12 · 42% remaining".
 */
export function entitlementLabel(e: LabelSource): string {
  if (e.unitType === "percent") return `${e.displayName} · ${e.quantityRemaining}% remaining`;
  const n = e.quantityRemaining;
  const noun = n === 1 ? e.unitLabel : e.unitLabelPlural;
  return `${n} ${titleCase(noun)} ${n === 1 ? "Waiting" : "Remaining"}`;
}

/** Big/small text pair for wallet cards. */
export function entitlementHeadline(e: LabelSource): { primary: string; secondary: string } {
  if (e.unitType === "percent") return { primary: e.displayName, secondary: `${e.quantityRemaining}% remaining` };
  const n = e.quantityRemaining;
  return {
    primary: `${n} ${titleCase(n === 1 ? e.unitLabel : e.unitLabelPlural)}`,
    secondary: n === 1 ? "waiting for you" : "remaining",
  };
}

/** Plain-language coverage: "any main up to $24", "Macallan 12", "any beer". */
export function coverageText(
  coverage: AnchorCoverage,
  options: { unitLabel: string; itemNames?: Record<string, string>; currency?: string; locale?: string },
): string {
  if (coverage.kind === "items") {
    const names = coverage.itemIds.map((id) => options.itemNames?.[id]).filter(Boolean) as string[];
    if (names.length === 0) return options.unitLabel;
    if (names.length <= 3) return names.join(" or ");
    return `${names.slice(0, 3).join(", ")} or ${names.length - 3} more`;
  }
  const noun = options.unitLabel.toLowerCase();
  if (coverage.maxCoveredPriceCents) {
    const cap = formatMoney(coverage.maxCoveredPriceCents, { currency: options.currency, locale: options.locale, compact: true });
    return `any ${noun} up to ${cap}`;
  }
  return `any ${noun}`;
}

export function titleCase(text: string): string {
  return text.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
