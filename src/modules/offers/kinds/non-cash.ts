/**
 * Offers that cost the merchant nothing directly:
 * - new_menu: "You still have a pasta waiting. Our new seafood menu launches Friday."
 * - premium_upgrade: "Your stored main covers dishes up to $24. Upgrade to our ribeye for +$8."
 * - priority_booking: recognition for regulars and high-value guests.
 * - anchor_upgrade: produced by the deal engine at checkout (not merchant-configured).
 */
import { z } from "zod";
import { itemsById, money, type OfferKind } from "./shared";

const newMenuSchema = z.object({ headline: z.string().min(3).max(140), itemIds: z.array(z.string()).default([]) });
export const newMenu: OfferKind<z.infer<typeof newMenuSchema>> = {
  key: "new_menu",
  label: "New menu trigger",
  description: "Tell anchor holders about new dishes — no discount needed.",
  example: "You still have a pasta waiting. Our new seafood menu launches Friday.",
  configurable: true,
  configSchema: newMenuSchema,
  isDiscount: () => false,
  promoCostCents: () => 0,
  customerLine: (c, ctx) => `${ctx.anchorLabel ? `You still have ${ctx.anchorLabel}. ` : ""}${c.headline}`,
  applyToBill: () => [],
};

const premiumSchema = z.object({ itemIds: z.array(z.string()).min(1) });
export const premiumUpgrade: OfferKind<z.infer<typeof premiumSchema>> = {
  key: "premium_upgrade",
  label: "Premium upgrade",
  description: "Customers put their anchor towards a premium item and pay the difference.",
  example: "Your stored main covers dishes up to $24. Upgrade to our ribeye for +$8.",
  configurable: true,
  configSchema: premiumSchema,
  isDiscount: () => false,
  promoCostCents: () => 0,
  customerLine(c, ctx) {
    const item = itemsById(ctx.catalog, c.itemIds)[0];
    return item ? `Treat yourself: put it towards our ${item.name.toLowerCase()} (${money(item.priceCents, ctx)}) and just pay the difference.` : "Upgrade to a premium dish and pay the difference.";
  },
  applyToBill: () => [],
};

const prioritySchema = z.object({ note: z.string().max(140).default("Reply to book your usual table — we'll hold it for you.") });
export const priorityBooking: OfferKind<z.infer<typeof prioritySchema>> = {
  key: "priority_booking",
  label: "Priority booking",
  description: "Recognition, not money: reserved seating or priority booking for valued guests.",
  example: "Your usual Saturday evening table is available.",
  configurable: true,
  configSchema: prioritySchema,
  isDiscount: () => false,
  promoCostCents: () => 0,
  customerLine: (c) => c.note,
  applyToBill: () => [],
};

export const anchorUpgrade: OfferKind<Record<string, never>> = {
  key: "anchor_upgrade",
  label: "Return Anchor upgrade",
  description: "Pay a little more today, keep part of the package for next time. Priced by the deal engine.",
  example: "For another $8, have your two mains tonight and we'll keep one main for your next visit.",
  configurable: false,
  configSchema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  isDiscount: () => false,
  promoCostCents: () => 0,
  customerLine: (_c, ctx) => ctx.anchorLabel,
  applyToBill: () => [],
};
