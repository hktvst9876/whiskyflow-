/** Shared contract for offer types (one file per type in this folder). */
import type { z } from "zod";
import { formatMoney } from "@/core/money";
import type { CatalogItem } from "../../catalog/types";
import type { LineType } from "../../visits/types";
import type { OfferTypeKey } from "../types";

export interface OfferCopyContext {
  catalog: CatalogItem[];
  /** Customer's anchor label, e.g. "1 Main Waiting" (may be empty). */
  anchorLabel: string;
  currency: string;
  locale: string;
}

/** A line staff add to the bill when the customer uses the offer. */
export interface OfferLine {
  itemId: string | null;
  name: string;
  category: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  lineType: LineType;
}

export interface BillLine {
  itemId: string | null;
  category: string;
  unitPriceCents: number;
  quantity: number;
  lineType: LineType;
}

export interface OfferKind<C extends Record<string, unknown> = Record<string, unknown>> {
  key: OfferTypeKey;
  label: string;
  description: string;
  example: string;
  /** Available in the merchant offer builder (anchor_upgrade is engine-made). */
  configurable: boolean;
  configSchema: z.ZodType<C>;
  isDiscount(config: C, catalog: CatalogItem[]): boolean;
  /** Merchant cost per use (perk cost or discount value). Paid items cost nothing extra. */
  promoCostCents(config: C, catalog: CatalogItem[]): number;
  /** One customer-facing sentence for messages and the wallet. */
  customerLine(config: C, ctx: OfferCopyContext): string;
  /** Lines to add to the bill when used. Throws a user-safe Error when it cannot apply. */
  applyToBill(config: C, catalog: CatalogItem[], bill: BillLine[]): OfferLine[];
}

export function money(cents: number, ctx: { currency: string; locale: string }) {
  return formatMoney(cents, { currency: ctx.currency, locale: ctx.locale, compact: true });
}

export function itemsById(catalog: CatalogItem[], ids: string[]): CatalogItem[] {
  const map = new Map(catalog.map((i) => [i.id, i]));
  return ids.map((id) => map.get(id)).filter((i): i is CatalogItem => Boolean(i));
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} + ${names[names.length - 1]}`;
}

/** Regular lines for the bundle items at full price, plus a discount line for the saving. */
export function bundleLines(items: CatalogItem[], bundlePriceCents: number): OfferLine[] {
  const lines: OfferLine[] = items.map((i) => ({
    itemId: i.id,
    name: i.name,
    category: i.category,
    quantity: 1,
    unitPriceCents: i.priceCents,
    unitCostCents: i.costCents,
    lineType: "regular",
  }));
  const full = items.reduce((s, i) => s + i.priceCents, 0);
  if (full > bundlePriceCents) {
    lines.push({ itemId: null, name: "Bundle saving", category: "discount", quantity: 1, unitPriceCents: bundlePriceCents - full, unitCostCents: 0, lineType: "discount" });
  }
  return lines;
}

export function perkLine(item: CatalogItem): OfferLine {
  return { itemId: item.id, name: `${item.name} (complimentary)`, category: item.category, quantity: 1, unitPriceCents: 0, unitCostCents: item.costCents, lineType: "perk" };
}
