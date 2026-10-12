/**
 * Next-visit upsell (pure). "Existing entitlement creates the visit; new spending creates
 * the profit." Ranks items by
 *   complement(anchorCategory → itemCategory) × (0.6 + 0.4·affinity) × gpWeight × partySizeBoost
 * excluding items already on the bill, and mixes in merchant bundles.
 */
import { formatMoney } from "@/core/money";
import type { CatalogItem } from "../catalog/types";

export interface UpsellBundle {
  offerDefinitionId: string;
  name: string;
  priceCents: number;
  costCents: number;
  /** Category this bundle pairs with (e.g. "beer" for wings + fries). */
  pairsWith: string | null;
}

export interface UpsellInput {
  /** Category of the anchor being redeemed, or the bill's main category. */
  anchorCategory: string | null;
  catalog: CatalogItem[];
  /** Item ids already on the bill. */
  excludeItemIds: ReadonlySet<string>;
  /** Share of the customer's past purchases per category (0-1). */
  affinity: Record<string, number>;
  partySize: number;
  /** Vertical complement map: anchorCategory → itemCategory → 0..1. */
  complements: Record<string, Record<string, number>>;
  bundles?: UpsellBundle[];
  limit?: number;
  currency?: string;
  locale?: string;
}

export interface UpsellRecommendation {
  kind: "item" | "bundle";
  itemId: string | null;
  offerDefinitionId: string | null;
  name: string;
  category: string;
  priceCents: number;
  costCents: number;
  gpCents: number;
  score: number;
  /** Rough chance the customer adds it when staff suggest it. */
  pAttach: number;
  expectedGpCents: number;
  script: string;
}

const COMPANION_TAGS = new Set(["companion", "shareable"]);

export function recommendUpsell(input: UpsellInput): UpsellRecommendation[] {
  const { anchorCategory, catalog, complements, partySize } = input;
  const map = (anchorCategory && complements[anchorCategory]) || complements["*"] || {};
  const candidates = catalog.filter((i) => i.active && i.priceCents > 0 && !input.excludeItemIds.has(i.id));
  const maxGp = Math.max(1, ...candidates.map((i) => i.priceCents - i.costCents), ...(input.bundles ?? []).map((b) => b.priceCents - b.costCents));
  const money = (c: number) => formatMoney(c, { currency: input.currency, locale: input.locale, compact: true, signed: true });

  const scored: UpsellRecommendation[] = [];
  for (const item of candidates) {
    const complement = map[item.category] ?? 0;
    if (complement <= 0) continue;
    const gp = item.priceCents - item.costCents;
    if (gp <= 0) continue;
    const affinity = input.affinity[item.category] ?? 0;
    const gpWeight = 0.5 + 0.5 * (gp / maxGp);
    const companion = item.tags.some((t) => COMPANION_TAGS.has(t));
    const partyBoost = companion ? 1 + 0.15 * Math.min(Math.max(partySize - 1, 0), 4) : 1;
    const score = complement * (0.6 + 0.4 * affinity) * gpWeight * partyBoost;
    const pAttach = Math.min(0.6, 0.1 + 0.35 * complement * (0.6 + 0.4 * affinity));
    scored.push({
      kind: "item",
      itemId: item.id,
      offerDefinitionId: null,
      name: item.name,
      category: item.category,
      priceCents: item.priceCents,
      costCents: item.costCents,
      gpCents: gp,
      score,
      pAttach,
      expectedGpCents: Math.round(gp * pAttach),
      script: scriptFor(item, companion && partySize > 1, money(item.priceCents)),
    });
  }

  for (const bundle of input.bundles ?? []) {
    const complement = bundle.pairsWith && anchorCategory ? (bundle.pairsWith === anchorCategory ? 1 : 0.4) : 0.6;
    const gp = bundle.priceCents - bundle.costCents;
    if (gp <= 0) continue;
    const score = complement * 0.8 * (0.5 + 0.5 * (gp / maxGp)) * 1.1;
    const pAttach = Math.min(0.6, 0.12 + 0.3 * complement);
    scored.push({
      kind: "bundle",
      itemId: null,
      offerDefinitionId: bundle.offerDefinitionId,
      name: bundle.name,
      category: "bundle",
      priceCents: bundle.priceCents,
      costCents: bundle.costCents,
      gpCents: gp,
      score,
      pAttach,
      expectedGpCents: Math.round(gp * pAttach),
      script: `Suggest the ${bundle.name} (${money(bundle.priceCents)}).`,
    });
  }

  scored.sort((a, b) => b.score - a.score || b.gpCents - a.gpCents);
  // Keep variety: at most two suggestions per category.
  const perCategory = new Map<string, number>();
  const result: UpsellRecommendation[] = [];
  for (const rec of scored) {
    const count = perCategory.get(rec.category) ?? 0;
    if (count >= 2) continue;
    perCategory.set(rec.category, count + 1);
    result.push(rec);
    if (result.length >= (input.limit ?? 4)) break;
  }
  return result;
}

function scriptFor(item: CatalogItem, forGuest: boolean, price: string): string {
  if (forGuest) return `Add a ${item.name} for your guest? (${price})`;
  if (item.tags.includes("mixer")) return `Fresh mixers with that? ${item.name} (${price})`;
  if (item.tags.includes("dessert")) return `Finish with the ${item.name}? (${price})`;
  if (item.tags.includes("addon")) return `Add ${item.name} to the session? (${price})`;
  if (item.tags.includes("premium")) return `Upgrade to ${item.name}? (${price})`;
  return `Pair it with ${item.name}? (${price})`;
}
