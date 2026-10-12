import { z } from "zod";
import { type OfferKind } from "./shared";

const schema = z.object({
  category: z.string().min(1),
  discountRate: z.number().min(0.05).max(0.5),
});
type Config = z.infer<typeof schema>;

/** "Use your stored main and bring a friend. Their second main is 15% off." */
export const bringAFriend: OfferKind<Config> = {
  key: "bring_a_friend",
  label: "Bring a friend",
  description: "The friend's item in a category is discounted when the customer redeems their anchor.",
  example: "Use your stored main and bring a friend. Their main is 15% off.",
  configurable: true,
  configSchema: schema,
  isDiscount: () => true,
  promoCostCents(c, catalog) {
    const prices = catalog.filter((i) => i.active && i.category === c.category).map((i) => i.priceCents);
    const avg = prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;
    return Math.round(avg * c.discountRate);
  },
  customerLine(c, ctx) {
    const lead = ctx.anchorLabel ? `Use your ${ctx.anchorLabel.toLowerCase()} and bring a friend` : "Bring a friend";
    return `${lead} — their ${c.category.replace(/_/g, " ")} is ${Math.round(c.discountRate * 100)}% off.`;
  },
  applyToBill(c, _catalog, bill) {
    const target = bill
      .filter((l) => l.lineType === "regular" && l.category === c.category)
      .sort((a, b) => b.unitPriceCents - a.unitPriceCents)[0];
    if (!target) throw new Error(`Add the friend's ${c.category.replace(/_/g, " ")} to the bill first.`);
    const discount = Math.round(target.unitPriceCents * c.discountRate);
    return [
      {
        itemId: null,
        name: `Bring-a-friend ${Math.round(c.discountRate * 100)}% off`,
        category: "discount",
        quantity: 1,
        unitPriceCents: -discount,
        unitCostCents: 0,
        lineType: "discount",
      },
    ];
  },
};
