import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CatalogItem } from "../catalog/types";
import { OFFER_KINDS } from "../offers/kinds";
import { recommendUpsell } from "./recommend";

const item = (id: string, category: string, price: number, cost: number, tags: string[] = []): CatalogItem => ({
  id,
  merchantId: "m",
  name: id,
  category,
  kind: "product",
  priceCents: price,
  costCents: cost,
  active: true,
  anchorable: false,
  tags,
  description: null,
  sortOrder: 0,
});

const catalog = [
  item("Chicken", "main", 2200, 700, ["companion"]),
  item("Fries", "side", 700, 150),
  item("Lemonade", "drink", 600, 100),
  item("Tiramisu", "dessert", 1100, 300, ["dessert"]),
  item("Ribeye", "main", 3800, 1500, ["premium", "companion"]),
];

const complements = { main: { main: 0.9, side: 0.8, drink: 0.85, dessert: 0.6 } };

describe("recommendUpsell", () => {
  it("suggests a companion main, sides and drinks around a stored main", () => {
    const recs = recommendUpsell({
      anchorCategory: "main",
      catalog,
      excludeItemIds: new Set(),
      affinity: { drink: 1 },
      partySize: 2,
      complements,
      limit: 4,
    });
    assert.equal(recs.length, 4);
    assert.ok(recs.some((r) => r.category === "main" && /for your guest/.test(r.script)));
    assert.ok(recs.every((r) => r.expectedGpCents > 0));
  });

  it("never re-suggests what is already on the bill", () => {
    const recs = recommendUpsell({ anchorCategory: "main", catalog, excludeItemIds: new Set(["Fries", "Lemonade"]), affinity: {}, partySize: 1, complements });
    assert.ok(!recs.some((r) => r.itemId === "Fries" || r.itemId === "Lemonade"));
  });
});

describe("offer kinds", () => {
  const ctx = { catalog, anchorLabel: "1 Main Waiting", currency: "SGD", locale: "en-SG" };

  it("prices bundles as a discount only when below the menu price", () => {
    const kind = OFFER_KINDS.stored_addon;
    const config = { itemIds: ["Fries", "Lemonade"], bundlePriceCents: 1100 };
    assert.equal(kind.isDiscount(config, catalog), true);
    assert.equal(kind.promoCostCents(config, catalog), 200);
    assert.equal(kind.customerLine(config, ctx), "You still have 1 Main Waiting. Add fries + lemonade for $11.");
    const lines = kind.applyToBill(config, catalog, []);
    assert.equal(lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0), 1100);
  });

  it("makes win-back perks complimentary items, not discounts", () => {
    const kind = OFFER_KINDS.win_back_perk;
    const config = { perkItemId: "Lemonade" };
    assert.equal(kind.isDiscount(config, catalog), false);
    assert.equal(kind.promoCostCents(config, catalog), 100);
    const [line] = kind.applyToBill(config, catalog, []);
    assert.deepEqual([line!.lineType, line!.unitPriceCents, line!.unitCostCents], ["perk", 0, 100]);
  });

  it("applies bring-a-friend to the friend's item on the bill", () => {
    const kind = OFFER_KINDS.bring_a_friend;
    const config = { category: "main", discountRate: 0.15 };
    assert.throws(() => kind.applyToBill(config, catalog, []), /Add the friend's main/);
    const [line] = kind.applyToBill(config, catalog, [{ itemId: "Chicken", category: "main", unitPriceCents: 2200, quantity: 1, lineType: "regular" }]);
    assert.equal(line!.unitPriceCents, -330);
  });
});
