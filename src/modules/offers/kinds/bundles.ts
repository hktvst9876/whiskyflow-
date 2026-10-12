/**
 * Bundle-style offers attached to an anchor:
 * - stored_addon: "You still have one main waiting. Add 2 drinks + fries for $15."
 * - food_drink_attach: "You have 2 beers remaining. Add wings + fries for $18."
 */
import { z } from "zod";
import type { CatalogItem } from "../../catalog/types";
import { bundleLines, itemsById, joinNames, money, type OfferKind } from "./shared";

const bundleSchema = z.object({
  itemIds: z.array(z.string()).min(1),
  bundlePriceCents: z.number().int().positive(),
});
type BundleConfig = z.infer<typeof bundleSchema>;

const fullPrice = (c: BundleConfig, catalog: CatalogItem[]) => itemsById(catalog, c.itemIds).reduce((s, i) => s + i.priceCents, 0);

function bundleKind(key: "stored_addon" | "food_drink_attach", label: string, description: string, example: string): OfferKind<BundleConfig> {
  return {
    key,
    label,
    description,
    example,
    configurable: true,
    configSchema: bundleSchema,
    isDiscount: (c, catalog) => c.bundlePriceCents < fullPrice(c, catalog),
    promoCostCents: (c, catalog) => Math.max(0, fullPrice(c, catalog) - c.bundlePriceCents),
    customerLine(c, ctx) {
      const names = itemsById(ctx.catalog, c.itemIds).map((i) => i.name.toLowerCase());
      const lead = ctx.anchorLabel ? `You still have ${ctx.anchorLabel}. ` : "";
      return `${lead}Add ${joinNames(names)} for ${money(c.bundlePriceCents, ctx)}.`;
    },
    applyToBill(c, catalog) {
      const items = itemsById(catalog, c.itemIds);
      if (items.length !== c.itemIds.length) throw new Error("Some bundle items are no longer on the menu.");
      return bundleLines(items, c.bundlePriceCents);
    },
  };
}

export const storedAddon = bundleKind(
  "stored_addon",
  "Stored item + add-on",
  "A bundle of new items to buy alongside the stored item.",
  "You still have one main waiting. Add 2 drinks + fries for $15.",
);

export const foodDrinkAttach = bundleKind(
  "food_drink_attach",
  "Food + drink attachment",
  "Attach food to drink anchors (or drinks to food anchors).",
  "You have 2 beers remaining. Add wings + fries for $18.",
);
