/**
 * Non-discount perks: high perceived value, low cost. Preferred over percentage discounts.
 * - off_peak_perk: "Use your stored main Mon–Thu and receive a complimentary side."
 * - win_back_perk: "Your main is still waiting. Return this week and we'll add a complimentary drink."
 * - renewal_bonus: "Renew your package today and receive a bonus side."
 */
import { z } from "zod";
import { itemsById, perkLine, type OfferKind } from "./shared";

const perkSchema = z.object({ perkItemId: z.string().min(1) });
type PerkConfig = z.infer<typeof perkSchema>;

function perkKind(
  key: "off_peak_perk" | "win_back_perk" | "renewal_bonus",
  label: string,
  description: string,
  example: string,
  line: (perk: string, anchorLabel: string) => string,
): OfferKind<PerkConfig> {
  return {
    key,
    label,
    description,
    example,
    configurable: true,
    configSchema: perkSchema,
    isDiscount: () => false,
    promoCostCents: (c, catalog) => itemsById(catalog, [c.perkItemId])[0]?.costCents ?? 0,
    customerLine(c, ctx) {
      const perk = itemsById(ctx.catalog, [c.perkItemId])[0]?.name.toLowerCase() ?? "treat";
      return line(perk, ctx.anchorLabel);
    },
    applyToBill(c, catalog) {
      const item = itemsById(catalog, [c.perkItemId])[0];
      if (!item) throw new Error("The perk item is no longer on the menu.");
      return [perkLine(item)];
    },
  };
}

export const offPeakPerk = perkKind(
  "off_peak_perk",
  "Off-peak perk",
  "A complimentary item when the anchor is used during off-peak hours.",
  "Use your stored main Monday–Thursday and receive a complimentary side.",
  (perk, anchor) => `${anchor ? `Use your ${anchor.toLowerCase()}` : "Visit"} on a weekday afternoon and we'll add a complimentary ${perk}.`,
);

export const winBackPerk = perkKind(
  "win_back_perk",
  "Win-back perk",
  "A small comeback perk for customers who have been away with an unused anchor. Never a discount, never escalating.",
  "Your main is still waiting. Return this week and we'll add a complimentary drink.",
  (perk) => ` Return this week and we'll add a complimentary ${perk}.`,
);

export const renewalBonus = perkKind(
  "renewal_bonus",
  "Renewal bonus",
  "A bonus item when a customer near the end of a package buys the next one.",
  "You have one meal remaining. Renew your dining package today and receive a bonus side.",
  (perk) => ` and receive a bonus ${perk}`,
);
