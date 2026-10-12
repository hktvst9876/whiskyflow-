/**
 * Vertical presets: everything a new merchant of a given type starts with. Adding a
 * vertical = adding one file in this folder and registering it in `index.ts`.
 * Items are referenced by `key` so programs and offers can point at them before ids exist.
 */
import type { AnchorIssueMode, AnchorPricing, AnchorRedemptionRules, AnchorTrigger, AnchorUnitType, RefundPolicy } from "@/modules/anchors/types";
import type { CategoryDef, ItemKind } from "@/modules/catalog/types";
import type { SettingsOverrides } from "@/modules/merchants/settings";
import type { Vertical } from "@/modules/merchants/types";
import type { OfferTypeKey } from "@/modules/offers/types";

export interface PresetItem {
  key: string;
  name: string;
  category: string;
  kind?: ItemKind;
  /** Major units for readability (22.5 = $22.50); converted to cents on import. */
  price: number;
  cost: number;
  anchorable?: boolean;
  tags?: string[];
  description?: string;
}

export type PresetCoverage =
  | { kind: "category"; category: string; maxCoveredPrice?: number }
  | { kind: "items"; itemKeys: string[] };

export interface PresetProgram {
  name: string;
  issueMode: AnchorIssueMode;
  unitType: AnchorUnitType;
  unitLabel: string;
  unitLabelPlural: string;
  unitsGranted: number;
  coverage: PresetCoverage;
  trigger: Omit<AnchorTrigger, "requiredItemIds"> & { minBasket?: number };
  pricing: AnchorPricing;
  validityDays: number;
  redemption: AnchorRedemptionRules;
  transferable: boolean;
  refundPolicy: RefundPolicy;
  upgradeAllowed: boolean;
  terms: string;
}

export interface PresetOffer {
  offerType: OfferTypeKey;
  name: string;
  /** Config with `itemKeys`/`perkItemKey` instead of ids; resolved on import. */
  config: Record<string, unknown>;
}

export interface DemoProfile {
  merchantName: string;
  slug: string;
  brandColor: string;
  /** Typical party sizes (sampled uniformly). */
  partySizes: number[];
  /** Average visits per day in the simulation. */
  visitsPerDay: number;
  /** Item keys a typical visit is built from, by category weight. */
  basket: { category: string; perGuest: number }[];
  bookingUrl?: string;
}

export interface VerticalPreset {
  key: Vertical;
  label: string;
  description: string;
  categories: CategoryDef[];
  items: PresetItem[];
  programs: PresetProgram[];
  offers: PresetOffer[];
  /** anchorCategory → itemCategory → strength (0-1). "*" = default row. */
  complements: Record<string, Record<string, number>>;
  settings: SettingsOverrides;
  demo?: DemoProfile;
}
