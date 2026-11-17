import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ValidationError } from "@/core/errors";
import { toCents } from "@/core/money";
import { randomSecret, sha256 } from "@/server/crypto";
import type { Db } from "@/server/db";
import { coverageText, entitlementLabel } from "@/modules/anchors/labels";
import { getProgram, insertProgram, updateProgram } from "@/modules/anchors/repo";
import { buildTermsSnapshot, transparencyLines } from "@/modules/anchors/terms";
import type { AnchorProgram, AnchorProgramInput } from "@/modules/anchors/types";
import { writeAudit } from "@/modules/audit/service";
import { findUserByEmail, insertMembership } from "@/modules/auth/repo";
import { memberships, users } from "@/modules/auth/schema";
import { createUser } from "@/modules/auth/service";
import { parseMenuCsv } from "@/modules/catalog/csv";
import { getItem, insertItem, listItems, updateItem } from "@/modules/catalog/repo";
import type { CatalogItem } from "@/modules/catalog/types";
import { coveredUnit, evaluateDeals, priceLadder, triggerFailures } from "@/modules/deals/engine";
import type { Basket, DealCandidate } from "@/modules/deals/types";
import { insertApiKey, listApiKeys, loadMerchantContext, revokeApiKey, saveSettingsOverrides, updateMerchantProfile } from "@/modules/merchants/repo";
import { deepMerge, validateSettingsPatch, type MerchantSettings, type SettingsOverrides } from "@/modules/merchants/settings";
import type { Role } from "@/modules/merchants/types";
import { merchantVisitBaseline } from "@/modules/visits/repo";
import type { FlowContext } from "./context";

/**
 * The merchant's controls (brief §13): menu with prices and costs, Return Anchor
 * programmes, guardrails, messaging and business rules, team and POS keys. The engine
 * only ever builds offers inside these boundaries, and every change is audited.
 */

// ── Settings ───────────────────────────────────────────────────────────────

/**
 * Save a settings change. Only the keys in `patch` are stored as merchant overrides, so
 * everything the merchant never touched keeps following the product and vertical defaults.
 */
export async function saveSettings(db: Db, ctx: FlowContext, patch: SettingsOverrides): Promise<MerchantSettings> {
  const merchant = await loadMerchantContext(db, ctx.merchantId);
  const result = validateSettingsPatch(merchant.settings, patch);
  if (!result.ok) throw new ValidationError("Please check the highlighted fields.", result.fieldErrors);
  const s = result.settings;
  const errors: Record<string, string> = {};
  if (s.messaging.reminderMinDays > s.messaging.reminderMaxDays) errors["messaging.reminderMinDays"] = "Must not be later than the latest reminder day.";
  if (s.messaging.maxMarketingPer7Days > s.messaging.maxMarketingPer30Days) errors["messaging.maxMarketingPer7Days"] = "Cannot exceed the 30-day cap.";
  for (const [i, b] of s.business.blackouts.entries()) if (b.start > b.end) errors[`business.blackouts.${i}.end`] = "End date is before the start date.";
  for (const [i, w] of s.business.offPeak.entries()) if (w.weekdays.length === 0) errors[`business.offPeak.${i}.weekdays`] = "Pick at least one day.";
  if (Object.keys(errors).length > 0) throw new ValidationError("Please check the highlighted fields.", errors);
  await saveSettingsOverrides(db, ctx.merchantId, deepMerge(merchant.overrides, patch));
  await writeAudit(db, {
    merchantId: ctx.merchantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    action: "settings.updated",
    entityType: "merchant",
    entityId: ctx.merchantId,
    data: { patch: patch as Record<string, unknown> },
    at: ctx.now,
  });
  return s;
}

export async function saveBusinessProfile(db: Db, ctx: FlowContext, input: { name: string; brandColor: string }): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Enter the business name.", { name: "Required." });
  if (!/^#[0-9a-fA-F]{6}$/.test(input.brandColor)) throw new ValidationError("Use a hex colour like #0f766e.", { brandColor: "Use a hex colour like #0f766e." });
  await updateMerchantProfile(db, ctx.merchantId, { name, brandColor: input.brandColor });
  await writeAudit(db, { merchantId: ctx.merchantId, actorType: ctx.actor.type, actorId: ctx.actor.id, action: "merchant.profile_updated", entityType: "merchant", entityId: ctx.merchantId, at: ctx.now });
}

// ── Menu (MVP step 1: items, prices, approximate costs) ───────────────────

export const itemInputSchema = z.object({
  name: z.string().trim().min(1, "Give the item a name.").max(80),
  category: z
    .string()
    .trim()
    .min(1, "Pick or type a category.")
    .max(40)
    .transform((c) => c.toLowerCase().replace(/\s+/g, "_")),
  kind: z.enum(["product", "service"]).default("product"),
  price: z.coerce.number().min(0, "Price cannot be negative.").max(100_000),
  cost: z.coerce.number().min(0, "Cost cannot be negative.").max(100_000),
  anchorable: z.boolean().default(false),
  active: z.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
  sku: z.string().trim().max(40).nullable().default(null),
});
export type ItemInput = z.input<typeof itemInputSchema>;

export async function saveItem(db: Db, ctx: FlowContext, raw: ItemInput, itemId: string | null): Promise<CatalogItem> {
  const input = itemInputSchema.parse(raw);
  const values = {
    name: input.name,
    category: input.category,
    kind: input.kind,
    priceCents: toCents(input.price),
    costCents: toCents(input.cost),
    anchorable: input.anchorable,
    active: input.active,
    tags: input.tags,
    sku: input.sku || null,
  };
  const item = itemId ? await updateItem(db, ctx.merchantId, itemId, values, ctx.now) : await insertItem(db, ctx.merchantId, values);
  await writeAudit(db, {
    merchantId: ctx.merchantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    action: itemId ? "catalog.item_updated" : "catalog.item_created",
    entityType: "catalog_item",
    entityId: item.id,
    data: { priceCents: values.priceCents, costCents: values.costCents },
    at: ctx.now,
  });
  return item;
}

export async function setItemActive(db: Db, ctx: FlowContext, itemId: string, active: boolean): Promise<void> {
  await getItem(db, ctx.merchantId, itemId);
  await updateItem(db, ctx.merchantId, itemId, { active }, ctx.now);
}

export interface MenuImportResult {
  created: number;
  updated: number;
  /** Lines that were skipped, and "Warning:" notes for lines that were imported. */
  problems: { line: number; message: string }[];
}

/** Import a menu CSV. Existing items are matched by SKU, then by exact name. */
export async function importMenuCsv(db: Db, ctx: FlowContext, text: string): Promise<MenuImportResult> {
  const parsed = parseMenuCsv(text);
  if (parsed.items.length === 0 && parsed.errors.length === 0) throw new ValidationError("Paste a CSV with a header row: name, category, price, cost.");
  const existing = await listItems(db, ctx.merchantId);
  const result: MenuImportResult = { created: 0, updated: 0, problems: parsed.errors };
  let sortOrder = existing.length;
  for (const row of parsed.items) {
    const match = (row.sku && existing.find((i) => i.sku === row.sku)) || existing.find((i) => i.name.toLowerCase() === row.name.toLowerCase());
    if (match) {
      await updateItem(db, ctx.merchantId, match.id, row, ctx.now);
      result.updated++;
    } else {
      existing.push(await insertItem(db, ctx.merchantId, { ...row, sortOrder: sortOrder++ }));
      result.created++;
    }
  }
  await writeAudit(db, { merchantId: ctx.merchantId, actorType: ctx.actor.type, actorId: ctx.actor.id, action: "catalog.imported", entityType: "merchant", entityId: ctx.merchantId, data: { created: result.created, updated: result.updated }, at: ctx.now });
  return result;
}

// ── Return Anchor programmes ───────────────────────────────────────────────

const rate = z.coerce.number().min(0).max(1);

export const programInputSchema = z
  .object({
    name: z.string().trim().min(3, "Give the programme a name.").max(80),
    status: z.enum(["active", "paused", "archived"]).default("active"),
    issueMode: z.enum(["upgrade_offer", "stored_purchase"]),
    unitType: z.enum(["item", "percent", "session"]),
    unitLabel: z.string().trim().min(1, "e.g. Main").max(24),
    unitLabelPlural: z.string().trim().min(1, "e.g. Mains").max(24),
    unitsGranted: z.coerce.number().int().min(1, "At least 1.").max(100),
    coverageKind: z.enum(["category", "items"]),
    coverageCategory: z.string().trim().max(40).default(""),
    /** Major units; empty = any item in the category. */
    maxCoveredPrice: z.union([z.literal(""), z.coerce.number().min(0)]).default(""),
    coverageItemIds: z.array(z.string().uuid()).default([]),
    /** "main:2, side:1" */
    requiredCategoryCounts: z.string().trim().max(200).default(""),
    requiredItemIds: z.array(z.string().uuid()).default([]),
    minPartySize: z.union([z.literal(""), z.coerce.number().int().min(1).max(50)]).default(""),
    minBasket: z.union([z.literal(""), z.coerce.number().min(0)]).default(""),
    minPriceRate: rate.default(0),
    maxPriceRate: rate.default(0),
    validityDays: z.coerce.number().int().min(1, "At least 1 day.").max(730),
    allowedWeekdays: z.array(z.coerce.number().int().min(0).max(6)).default([]),
    offPeakOnly: z.boolean().default(false),
    requiresNewPurchase: z.boolean().default(false),
    minNewSpend: z.union([z.literal(""), z.coerce.number().min(0)]).default(""),
    maxUnitsPerVisit: z.union([z.literal(""), z.coerce.number().int().min(1).max(100)]).default(""),
    transferable: z.boolean().default(false),
    refundPolicy: z.enum(["none", "unused_within_14_days", "unused_any_time"]),
    upgradeAllowed: z.boolean().default(false),
    terms: z.string().trim().max(400).default(""),
  })
  .superRefine((p, issue) => {
    if (p.coverageKind === "category" && !p.coverageCategory) issue.addIssue({ code: "custom", path: ["coverageCategory"], message: "Choose the category it covers." });
    if (p.coverageKind === "items" && p.coverageItemIds.length === 0) issue.addIssue({ code: "custom", path: ["coverageItemIds"], message: "Choose at least one item." });
    if (p.issueMode === "upgrade_offer") {
      if (p.minPriceRate > p.maxPriceRate) issue.addIssue({ code: "custom", path: ["minPriceRate"], message: "Lowest price is above the highest price." });
      if (p.maxPriceRate <= 0) issue.addIssue({ code: "custom", path: ["maxPriceRate"], message: "Set the price range (share of the kept item's menu price)." });
    }
    if (p.unitType === "percent" && p.issueMode !== "stored_purchase") issue.addIssue({ code: "custom", path: ["unitType"], message: "Bottle levels are for things kept after purchase." });
    for (const part of p.requiredCategoryCounts.split(",").map((x) => x.trim()).filter(Boolean)) {
      if (!/^[a-z0-9_ ]+:\s*\d+$/i.test(part)) issue.addIssue({ code: "custom", path: ["requiredCategoryCounts"], message: 'Use "category:count", e.g. "main:2, side:1".' });
    }
  });
export type ProgramFormInput = z.input<typeof programInputSchema>;

const optional = (v: number | ""): number | undefined => (v === "" ? undefined : v);

export function programFromForm(raw: ProgramFormInput): AnchorProgramInput {
  const p = programInputSchema.parse(raw);
  const counts: Record<string, number> = {};
  for (const part of p.requiredCategoryCounts.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [category, count] = part.split(":");
    counts[category!.trim().toLowerCase().replace(/\s+/g, "_")] = Number(count);
  }
  const maxCovered = optional(p.maxCoveredPrice);
  const minBasket = optional(p.minBasket);
  const minNewSpend = optional(p.minNewSpend);
  return {
    name: p.name,
    status: p.status,
    issueMode: p.issueMode,
    unitType: p.unitType,
    unitLabel: p.unitLabel,
    unitLabelPlural: p.unitLabelPlural,
    unitsGranted: p.unitType === "percent" ? 100 : p.unitsGranted,
    coverage:
      p.coverageKind === "category"
        ? { kind: "category", category: p.coverageCategory.toLowerCase().replace(/\s+/g, "_"), maxCoveredPriceCents: maxCovered === undefined ? null : toCents(maxCovered) }
        : { kind: "items", itemIds: p.coverageItemIds },
    trigger: {
      ...(Object.keys(counts).length > 0 ? { requiredCategoryCounts: counts } : {}),
      ...(p.requiredItemIds.length > 0 ? { requiredItemIds: p.requiredItemIds } : {}),
      ...(optional(p.minPartySize) !== undefined ? { minPartySize: optional(p.minPartySize) } : {}),
      ...(minBasket !== undefined && minBasket > 0 ? { minBasketCents: toCents(minBasket) } : {}),
    },
    pricing: p.issueMode === "upgrade_offer" ? { minPriceRate: p.minPriceRate, maxPriceRate: p.maxPriceRate } : { minPriceRate: 0, maxPriceRate: 0 },
    validityDays: p.validityDays,
    redemption: {
      ...(p.allowedWeekdays.length > 0 && p.allowedWeekdays.length < 7 ? { allowedWeekdays: [...p.allowedWeekdays].sort() } : {}),
      ...(p.offPeakOnly ? { offPeakOnly: true } : {}),
      ...(p.requiresNewPurchase ? { requiresNewPurchase: true } : {}),
      ...(minNewSpend !== undefined && minNewSpend > 0 ? { minNewSpendCents: toCents(minNewSpend) } : {}),
      ...(optional(p.maxUnitsPerVisit) !== undefined ? { maxUnitsPerVisit: optional(p.maxUnitsPerVisit) } : {}),
    },
    transferable: p.transferable,
    refundPolicy: p.refundPolicy,
    upgradeAllowed: p.upgradeAllowed,
    terms: p.terms,
  };
}

/** Create or update a programme. Anchors already sold keep the terms they were sold with. */
export async function saveProgram(db: Db, ctx: FlowContext, raw: ProgramFormInput, programId: string | null): Promise<AnchorProgram> {
  const input = programFromForm(raw);
  const program = programId ? await updateProgram(db, ctx.merchantId, programId, input, ctx.now) : await insertProgram(db, ctx.merchantId, input, ctx.now);
  await writeAudit(db, {
    merchantId: ctx.merchantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    action: programId ? "anchor_program.updated" : "anchor_program.created",
    entityType: "anchor_program",
    entityId: program.id,
    data: { name: program.name, status: program.status },
    at: ctx.now,
  });
  return program;
}

export async function setProgramStatus(db: Db, ctx: FlowContext, programId: string, status: AnchorProgram["status"]): Promise<void> {
  await getProgram(db, ctx.merchantId, programId);
  await updateProgram(db, ctx.merchantId, programId, { status }, ctx.now);
  await writeAudit(db, { merchantId: ctx.merchantId, actorType: ctx.actor.type, actorId: ctx.actor.id, action: "anchor_program.status", entityType: "anchor_program", entityId: programId, data: { status }, at: ctx.now });
}

export interface ProgramPreview {
  /** The sample bill the preview ran on. */
  basket: { name: string; quantity: number; priceCents: number }[];
  basketRevenueCents: number;
  partySize: number;
  /** What the customer would see in their wallet. */
  walletLabel: string;
  coverage: string;
  terms: { label: string; value: string }[];
  candidate: DealCandidate | null;
  /** Every price point the engine may try, before economics. */
  ladder: { priceCents: number; priceRate: number }[];
  /** Why the trigger does not match the sample bill (empty when it does). */
  triggerProblems: string[];
  note: string;
}

/** The smallest realistic bill that satisfies a programme's trigger. */
export function sampleBasketFor(program: AnchorProgram | AnchorProgramInput, catalog: CatalogItem[]): { basket: Basket; shown: ProgramPreview["basket"] } {
  const active = catalog.filter((i) => i.active && i.priceCents > 0);
  const lines: Basket["lines"] = [];
  const shown: ProgramPreview["basket"] = [];
  const add = (item: CatalogItem, quantity: number) => {
    lines.push({ itemId: item.id, category: item.category, quantity, unitPriceCents: item.priceCents, unitCostCents: item.costCents });
    shown.push({ name: item.name, quantity, priceCents: item.priceCents });
  };
  for (const [category, count] of Object.entries(program.trigger.requiredCategoryCounts ?? {})) {
    const inCategory = active.filter((i) => i.category === category).sort((a, b) => a.priceCents - b.priceCents);
    const typical = inCategory[Math.floor(inCategory.length / 2)];
    if (typical) add(typical, count);
  }
  for (const id of program.trigger.requiredItemIds ?? []) {
    const item = active.find((i) => i.id === id);
    if (item && !lines.some((l) => l.itemId === id)) {
      add(item, 1);
      break;
    }
  }
  if (lines.length === 0 && active[0]) add(active[0], 1);
  // Pad to the minimum basket with the most common add-on so the trigger can match.
  const filler = active.filter((i) => !lines.some((l) => l.itemId === i.id)).sort((a, b) => a.priceCents - b.priceCents)[0] ?? active[0];
  const revenue = () => lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  for (let guard = 0; filler && program.trigger.minBasketCents && revenue() < program.trigger.minBasketCents && guard < 50; guard++) add(filler, 1);
  return { basket: { lines, partySize: Math.max(2, program.trigger.minPartySize ?? 2) }, shown };
}

/**
 * Live economics for a programme being edited: what staff would be told to offer on a
 * typical qualifying bill from a first-time customer, and what blocks it if nothing.
 */
export async function previewProgram(db: Db, ctx: FlowContext, raw: ProgramFormInput): Promise<ProgramPreview> {
  const merchant = await loadMerchantContext(db, ctx.merchantId);
  const catalog = await listItems(db, ctx.merchantId, { activeOnly: true });
  const input = programFromForm(raw);
  const program: AnchorProgram = { ...input, status: "active", id: "preview", merchantId: ctx.merchantId, createdAt: ctx.now, updatedAt: ctx.now };
  const { basket, shown } = sampleBasketFor(program, catalog);
  const revenue = basket.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const cost = basket.lines.reduce((s, l) => s + l.unitCostCents * l.quantity, 0);
  const itemNames = Object.fromEntries(catalog.map((i) => [i.id, i.name]));
  const format = { currency: merchant.merchant.currency, locale: merchant.merchant.locale };
  const coverage = coverageText(program.coverage, { unitLabel: program.unitLabel, itemNames, ...format });
  const expiresAt = new Date(ctx.now.getTime() + program.validityDays * 86_400_000);
  const base = {
    basket: shown,
    basketRevenueCents: revenue,
    partySize: basket.partySize,
    walletLabel: entitlementLabel({
      unitType: program.unitType,
      quantityRemaining: program.unitType === "percent" ? 60 : program.unitsGranted,
      unitLabel: program.unitLabel,
      unitLabelPlural: program.unitLabelPlural,
      displayName: program.unitType === "percent" ? (shown[0]?.name ?? program.unitLabel) : program.unitLabel,
    }),
    coverage,
    terms: transparencyLines(
      buildTermsSnapshot({ programName: program.name, coverageText: coverage, expiresAt, redemption: program.redemption, transferable: program.transferable, refundPolicy: program.refundPolicy, upgradeAllowed: program.upgradeAllowed, terms: program.terms, pricePaidCents: 0, currency: format.currency, issuedAt: ctx.now }),
      { locale: format.locale, timeZone: merchant.merchant.timezone },
    ),
  };
  if (program.issueMode === "stored_purchase") {
    return { ...base, candidate: null, ladder: [], triggerProblems: [], note: "Kept after purchase: staff press “Keep the rest” on the bill. The customer already paid, so there is no upgrade price to work out." };
  }
  const history = await merchantVisitBaseline(db, ctx.merchantId, new Date(ctx.now.getTime() - 90 * 86_400_000), ctx.now);
  const result = evaluateDeals(
    {
      basket,
      catalog,
      programs: [program],
      customer: null,
      baseline: history.visits >= 20 ? { avgVisitGpCents: history.avgGpCents, avgVisitSpendCents: history.avgSpendCents } : { avgVisitGpCents: revenue - cost, avgVisitSpendCents: revenue },
      settings: merchant.settings,
    },
    format.currency,
    format.locale,
  );
  const unit = coveredUnit(program, catalog);
  const ladder = unit ? priceLadder(program.unitsGranted * unit.unitRetailCents, program, merchant.settings.dealEngine.priceLadderRates, merchant.settings.dealEngine.roundingCents) : [];
  const candidate = result.candidates[0] ?? null;
  return {
    ...base,
    candidate,
    ladder,
    triggerProblems: triggerFailures(program, basket, format.currency),
    note: candidate?.eligible
      ? "This is what staff would be shown for a first-time customer on a typical qualifying bill."
      : "On a typical qualifying bill this programme would NOT be offered. Adjust the price range, what it covers, or the guardrails.",
  };
}

// ── Team ───────────────────────────────────────────────────────────────────

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: Role;
  lastLoginAt: Date | null;
}

export async function listTeam(db: Db, merchantId: string): Promise<TeamMember[]> {
  return db
    .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, lastLoginAt: users.lastLoginAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.merchantId, merchantId))
    .orderBy(asc(users.name));
}

/** Add a team member with a temporary password (owners only; they pass it on in person). */
export async function addTeamMember(db: Db, ctx: FlowContext, input: { email: string; name: string; password: string; role: Role }): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) throw new ValidationError("Enter a valid email address.", { email: "Enter a valid email address." });
  if (!input.name.trim()) throw new ValidationError("Enter their name.", { name: "Required." });
  if (input.role === "owner") throw new ValidationError("Ownership cannot be handed out from here.", { role: "Choose manager or staff." });
  const existing = await findUserByEmail(db, email);
  const user = existing ?? (await createUser(db, { email, name: input.name, password: input.password }));
  await insertMembership(db, { userId: user.id, merchantId: ctx.merchantId, role: input.role });
  await writeAudit(db, { merchantId: ctx.merchantId, actorType: ctx.actor.type, actorId: ctx.actor.id, action: "team.member_added", entityType: "user", entityId: user.id, data: { role: input.role }, at: ctx.now });
}

export async function removeTeamMember(db: Db, ctx: FlowContext, userId: string): Promise<void> {
  if (userId === ctx.actor.id) throw new ValidationError("You cannot remove yourself.");
  const [row] = await db.select().from(memberships).where(and(eq(memberships.merchantId, ctx.merchantId), eq(memberships.userId, userId)));
  if (!row) throw new ValidationError("That person is not on this team.");
  if (row.role === "owner") throw new ValidationError("An owner cannot be removed from here.");
  await db.delete(memberships).where(and(eq(memberships.merchantId, ctx.merchantId), eq(memberships.userId, userId)));
  await writeAudit(db, { merchantId: ctx.merchantId, actorType: ctx.actor.type, actorId: ctx.actor.id, action: "team.member_removed", entityType: "user", entityId: userId, at: ctx.now });
}

// ── POS API keys ───────────────────────────────────────────────────────────

/** Create a POS key. The raw value is returned ONCE; only its hash is stored. */
export async function createPosApiKey(db: Db, ctx: FlowContext, name: string): Promise<{ secret: string }> {
  const label = name.trim();
  if (!label) throw new ValidationError("Name the key after where it will be used (e.g. “Front till”).", { name: "Required." });
  const secret = `ra_${randomSecret(30)}`;
  const key = await insertApiKey(db, { merchantId: ctx.merchantId, name: label, prefix: secret.slice(0, 10), keyHash: sha256(secret), scopes: ["pos:write"], createdBy: ctx.actor.id });
  await writeAudit(db, { merchantId: ctx.merchantId, actorType: ctx.actor.type, actorId: ctx.actor.id, action: "api_key.created", entityType: "api_key", entityId: key.id, data: { name: label }, at: ctx.now });
  return { secret };
}

export async function revokePosApiKey(db: Db, ctx: FlowContext, keyId: string): Promise<void> {
  await revokeApiKey(db, ctx.merchantId, keyId, ctx.now);
  await writeAudit(db, { merchantId: ctx.merchantId, actorType: ctx.actor.type, actorId: ctx.actor.id, action: "api_key.revoked", entityType: "api_key", entityId: keyId, at: ctx.now });
}

export { listApiKeys };
