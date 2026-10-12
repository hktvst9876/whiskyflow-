import "server-only";
import { ValidationError } from "@/core/errors";
import { toCents } from "@/core/money";
import type { Db } from "@/server/db";
import { insertProgram } from "@/modules/anchors/repo";
import type { AnchorCoverage, AnchorProgramInput } from "@/modules/anchors/types";
import { insertMembership } from "@/modules/auth/repo";
import { insertItem, listItems } from "@/modules/catalog/repo";
import type { CatalogItem } from "@/modules/catalog/types";
import { ensureExperiment } from "@/modules/experiments/repo";
import { CHECKOUT_EXPERIMENT_KEY } from "@/modules/experiments/types";
import { findMerchantBySlug, insertMerchant, loadMerchantContext } from "@/modules/merchants/repo";
import type { Merchant, Vertical } from "@/modules/merchants/types";
import { offerKind } from "@/modules/offers/kinds";
import { insertDefinition } from "@/modules/offers/repo";
import { verticalPreset } from "@/verticals";
import type { PresetOffer, PresetProgram } from "@/verticals/types";

/**
 * MVP step 1 and merchant onboarding: a new merchant starts from a vertical preset —
 * menu with prices and approximate costs, anchor programs, offers and settings — and
 * edits from there. Nothing is hidden: every number the engine uses is editable.
 */

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "merchant"
  );
}

async function uniqueSlug(db: Db, base: string): Promise<string> {
  let slug = base;
  for (let i = 2; await findMerchantBySlug(db, slug); i++) slug = `${base}-${i}`;
  return slug;
}

export function programInputFromPreset(p: PresetProgram, keyToId: Map<string, string>): AnchorProgramInput {
  const coverage: AnchorCoverage =
    p.coverage.kind === "category"
      ? { kind: "category", category: p.coverage.category, maxCoveredPriceCents: p.coverage.maxCoveredPrice !== undefined ? toCents(p.coverage.maxCoveredPrice) : null }
      : { kind: "items", itemIds: p.coverage.itemKeys.map((k) => keyToId.get(k)).filter((id): id is string => Boolean(id)) };
  const { minBasket, ...trigger } = p.trigger;
  return {
    name: p.name,
    status: "active",
    issueMode: p.issueMode,
    unitType: p.unitType,
    unitLabel: p.unitLabel,
    unitLabelPlural: p.unitLabelPlural,
    unitsGranted: p.unitsGranted,
    coverage,
    trigger: { ...trigger, ...(minBasket !== undefined ? { minBasketCents: toCents(minBasket) } : {}) },
    pricing: p.pricing,
    validityDays: p.validityDays,
    redemption: p.redemption,
    transferable: p.transferable,
    refundPolicy: p.refundPolicy,
    upgradeAllowed: p.upgradeAllowed,
    terms: p.terms,
  };
}

/** Resolve preset item keys and major-unit prices in an offer config to ids and cents. */
export function offerConfigFromPreset(o: PresetOffer, keyToId: Map<string, string>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(o.config)) {
    if (key === "itemKeys") config.itemIds = (value as string[]).map((k) => keyToId.get(k)).filter(Boolean);
    else if (key === "perkItemKey") config.perkItemId = keyToId.get(value as string);
    else if (key === "bundlePrice") config.bundlePriceCents = toCents(value as number);
    else config[key] = value;
  }
  return config;
}

export async function createOfferFromConfig(
  db: Db,
  merchantId: string,
  input: { offerType: PresetOffer["offerType"]; name: string; config: Record<string, unknown> },
  catalog: CatalogItem[],
  at: Date,
) {
  const kind = offerKind(input.offerType);
  if (!kind.configurable) throw new ValidationError("This offer type is created by the deal engine.");
  const parsed = kind.configSchema.safeParse(input.config);
  if (!parsed.success) throw new ValidationError(`Offer "${input.name}": ${parsed.error.issues[0]?.message ?? "invalid settings"}`);
  return insertDefinition(db, {
    merchantId,
    offerType: input.offerType,
    name: input.name,
    isDiscount: kind.isDiscount(parsed.data, catalog),
    config: parsed.data,
    estCostCents: kind.promoCostCents(parsed.data, catalog),
    at,
  });
}

export interface CreateMerchantInput {
  name: string;
  vertical: Vertical;
  slug?: string;
  brandColor?: string;
  ownerUserId?: string | null;
  /** Start without the preset's sample menu (the merchant imports their own CSV). */
  emptyMenu?: boolean;
  settings?: Record<string, unknown>;
  now: Date;
}

export async function createMerchantFromPreset(db: Db, input: CreateMerchantInput): Promise<Merchant> {
  if (!input.name.trim()) throw new ValidationError("Enter the business name.", { name: "Required." });
  const preset = verticalPreset(input.vertical);
  const merchant = await insertMerchant(db, {
    name: input.name.trim(),
    slug: await uniqueSlug(db, input.slug ?? slugify(input.name)),
    vertical: input.vertical,
    brandColor: input.brandColor ?? preset.demo?.brandColor ?? "#0f766e",
    settings: input.settings ?? {},
  });
  const keyToId = new Map<string, string>();
  if (!input.emptyMenu) {
    let order = 0;
    for (const item of preset.items) {
      const created = await insertItem(db, merchant.id, {
        name: item.name,
        category: item.category,
        kind: item.kind ?? "product",
        priceCents: toCents(item.price),
        costCents: toCents(item.cost),
        anchorable: item.anchorable ?? false,
        tags: item.tags ?? [],
        description: item.description ?? null,
        sortOrder: order++,
      });
      keyToId.set(item.key, created.id);
    }
  }
  for (const p of preset.programs) {
    const program = programInputFromPreset(p, keyToId);
    if (program.coverage.kind === "items" && program.coverage.itemIds.length === 0) program.status = "paused";
    await insertProgram(db, merchant.id, program, input.now);
  }
  if (!input.emptyMenu) {
    const catalog = await listItems(db, merchant.id);
    for (const o of preset.offers) {
      await createOfferFromConfig(db, merchant.id, { offerType: o.offerType, name: o.name, config: offerConfigFromPreset(o, keyToId) }, catalog, input.now);
    }
  }
  if (input.ownerUserId) await insertMembership(db, { userId: input.ownerUserId, merchantId: merchant.id, role: "owner" });
  const ctx = await loadMerchantContext(db, merchant.id);
  await ensureExperiment(db, {
    merchantId: merchant.id,
    key: CHECKOUT_EXPERIMENT_KEY,
    name: "Checkout Return Anchor offers",
    holdoutRate: ctx.settings.experiment.holdoutRate,
    at: input.now,
  });
  return merchant;
}
