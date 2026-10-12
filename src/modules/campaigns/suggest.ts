/**
 * Campaign suggestions (pure). Each suggestion targets a segment with the playbook's
 * preferred (usually non-discount) offer, and estimates cost and return up front. Every
 * launch keeps a holdout so actual performance is measured, not assumed.
 */
import type { OfferDefinition, OfferTypeKey } from "../offers/types";
import { PLAYBOOKS } from "../scoring/playbooks";
import type { Segment } from "../scoring/types";
import type { CampaignKind, CampaignSuggestion } from "./types";

export interface CampaignCustomer {
  id: string;
  segment: Segment | null;
  hasActiveAnchor: boolean;
  /** An item/session anchor with exactly one unit left. */
  oneUnitLeft: boolean;
  daysSinceLastVisit: number | null;
  marketingOptIn: boolean;
}

interface Recipe {
  kind: CampaignKind;
  name: string;
  why: string;
  segment: CampaignSuggestion["segment"];
  offerTypes: OfferTypeKey[];
  /** Assumed share of the audience making an extra visit because of the message (prior). */
  responseLift: number;
  filter(c: CampaignCustomer): boolean;
}

const RECIPES: Recipe[] = [
  {
    kind: "win_back",
    name: "Win back lapsed anchor holders",
    why: "They own something here but haven't been back. A reminder plus a small perk — never a discount.",
    segment: "at_risk",
    offerTypes: ["win_back_perk"],
    responseLift: 0.08,
    filter: (c) => c.segment === "at_risk" && c.hasActiveAnchor,
  },
  {
    kind: "bring_a_friend",
    name: "Bring a friend with your anchor",
    why: "Persuadable customers with something waiting; a friend turns one redemption into two covers.",
    segment: "persuadable",
    offerTypes: ["bring_a_friend", "stored_addon", "food_drink_attach"],
    responseLift: 0.06,
    filter: (c) => c.segment === "persuadable" && c.hasActiveAnchor,
  },
  {
    kind: "new_menu",
    name: "New menu early access for regulars",
    why: "Regulars come back anyway — give them recognition and news, not money.",
    segment: "likely_regular",
    offerTypes: ["new_menu", "priority_booking"],
    responseLift: 0.03,
    filter: (c) => c.segment === "likely_regular" || c.segment === "high_value",
  },
  {
    kind: "vip_recognition",
    name: "VIP priority booking",
    why: "High-value guests and groups: reserve their table and make them feel known.",
    segment: "high_value",
    offerTypes: ["priority_booking"],
    responseLift: 0.04,
    filter: (c) => c.segment === "high_value",
  },
  {
    kind: "renewal",
    name: "Renew before it runs out",
    why: "One unit left: invite them to renew with a bonus perk on the next visit.",
    segment: "anchor_holders",
    offerTypes: ["renewal_bonus"],
    responseLift: 0.07,
    filter: (c) => c.oneUnitLeft,
  },
];

export function audienceFor(kind: CampaignKind, customers: CampaignCustomer[]): string[] {
  const recipe = RECIPES.find((r) => r.kind === kind);
  if (!recipe) return [];
  return customers.filter((c) => c.marketingOptIn && recipe.filter(c)).map((c) => c.id);
}

export function suggestCampaigns(input: {
  customers: CampaignCustomer[];
  definitions: OfferDefinition[];
  avgVisitGpCents: number;
  messageCostCents: number;
  /** Estimated share of recipients who use the offer when they come. */
  redemptionShare?: number;
}): CampaignSuggestion[] {
  const suggestions: CampaignSuggestion[] = [];
  for (const recipe of RECIPES) {
    const audience = audienceFor(recipe.kind, input.customers);
    if (audience.length === 0) continue;
    const playbook = recipe.segment === "anchor_holders" || recipe.segment === "all" ? null : PLAYBOOKS[recipe.segment];
    const offer =
      input.definitions
        .filter((d) => d.status === "active" && recipe.offerTypes.includes(d.offerType))
        .filter((d) => !d.isDiscount || (playbook?.discountsAllowed ?? false))
        .sort((a, b) => Number(a.isDiscount) - Number(b.isDiscount) || a.estCostCents - b.estCostCents)[0] ?? null;
    const n = audience.length;
    const redemptionShare = input.redemptionShare ?? 0.3;
    const expectedCost = Math.round(n * input.messageCostCents + n * redemptionShare * recipe.responseLift * 3 * (offer?.estCostCents ?? 0));
    const expectedReturn = Math.round(n * recipe.responseLift * input.avgVisitGpCents);
    suggestions.push({
      kind: recipe.kind,
      name: recipe.name,
      segment: recipe.segment,
      why: recipe.why,
      audienceCount: n,
      offerDefinitionId: offer?.id ?? null,
      offerSummary: offer ? offer.name : "Reminder only (no offer)",
      isDiscount: offer?.isDiscount ?? false,
      expectedCostCents: expectedCost,
      expectedReturnCents: expectedReturn,
    });
  }
  return suggestions.sort((a, b) => b.expectedReturnCents - b.expectedCostCents - (a.expectedReturnCents - a.expectedCostCents));
}
