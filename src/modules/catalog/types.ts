/** Catalog (menu items and services) domain types. */

export type ItemKind = "product" | "service";

/**
 * Well-known item tags used by the upsell engine and presets. Merchants can add any
 * string; these just have built-in meaning.
 */
export const KNOWN_TAGS = [
  "premium", // eligible as a premium upgrade target
  "companion", // good second item for a guest (e.g. a main for a friend)
  "mixer", // bar mixers
  "bottle", // bottle-keep eligible spirits/wine
  "shareable", // finger food, platters
  "dessert",
  "addon", // service add-ons (aromatherapy, hot stones)
  "new", // new menu items
] as const;

export interface CatalogItem {
  id: string;
  merchantId: string;
  name: string;
  /** Category key, e.g. "main", "side", "beer", "spirit_bottle", "massage". */
  category: string;
  kind: ItemKind;
  priceCents: number;
  /** Approximate cost of goods / service delivery cost. Drives every economic decision. */
  costCents: number;
  active: boolean;
  /** Can this item be stored as (or covered by) a Return Anchor? */
  anchorable: boolean;
  tags: string[];
  description: string | null;
  sortOrder: number;
}

/** A category definition supplied by a vertical preset. */
export interface CategoryDef {
  key: string;
  label: string;
  /** Singular unit noun used on wallets, e.g. "Main", "Pint", "Massage". */
  unitLabel?: string;
  unitLabelPlural?: string;
}

/** Input shape for creating/updating items (IDs and merchant are supplied by the service). */
export interface CatalogItemInput {
  name: string;
  category: string;
  kind?: ItemKind;
  priceCents: number;
  costCents: number;
  active?: boolean;
  anchorable?: boolean;
  tags?: string[];
  description?: string | null;
  sortOrder?: number;
}
