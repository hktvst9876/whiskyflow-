import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { NotFoundError } from "@/core/errors";
import type { Db } from "@/server/db";
import { verticalPreset } from "@/verticals";
import { apiKeys, locations, merchants, webhookEvents } from "./schema";
import { parseSettings, type MerchantSettings } from "./settings";
import type { Merchant, Vertical } from "./types";

type MerchantRow = typeof merchants.$inferSelect;

export function toMerchant(row: MerchantRow): Merchant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    vertical: row.vertical,
    currency: row.currency,
    timezone: row.timezone,
    locale: row.locale,
    country: row.country,
    brandColor: row.brandColor,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export interface MerchantContext {
  merchant: Merchant;
  settings: MerchantSettings;
  /** Stored overrides only (for the settings editor). */
  overrides: Record<string, unknown>;
}

export async function getMerchant(db: Db, merchantId: string): Promise<Merchant> {
  const [row] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
  if (!row) throw new NotFoundError("Merchant not found.");
  return toMerchant(row);
}

/** Merchant + effective settings (defaults ← vertical preset ← overrides). */
export async function loadMerchantContext(db: Db, merchantId: string): Promise<MerchantContext> {
  const [row] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
  if (!row) throw new NotFoundError("Merchant not found.");
  return {
    merchant: toMerchant(row),
    settings: parseSettings(row.settings, verticalPreset(row.vertical).settings),
    overrides: row.settings ?? {},
  };
}

export async function listMerchants(db: Db): Promise<Merchant[]> {
  const rows = await db.select().from(merchants).where(eq(merchants.status, "active")).orderBy(asc(merchants.createdAt));
  return rows.map(toMerchant);
}

export async function findMerchantBySlug(db: Db, slug: string): Promise<Merchant | null> {
  const [row] = await db.select().from(merchants).where(eq(merchants.slug, slug));
  return row ? toMerchant(row) : null;
}

export async function insertMerchant(
  db: Db,
  input: { name: string; slug: string; vertical: Vertical; currency?: string; timezone?: string; locale?: string; country?: string; brandColor?: string; settings?: Record<string, unknown> },
): Promise<Merchant> {
  const [row] = await db.insert(merchants).values(input).returning();
  await db.insert(locations).values({ merchantId: row!.id, name: input.name });
  return toMerchant(row!);
}

export async function updateMerchantProfile(
  db: Db,
  merchantId: string,
  patch: Partial<Pick<Merchant, "name" | "brandColor" | "timezone" | "currency" | "locale" | "country">>,
) {
  await db.update(merchants).set(patch).where(eq(merchants.id, merchantId));
}

export async function saveSettingsOverrides(db: Db, merchantId: string, overrides: Record<string, unknown>) {
  await db.update(merchants).set({ settings: overrides }).where(eq(merchants.id, merchantId));
}

export async function primaryLocationId(db: Db, merchantId: string): Promise<string | null> {
  const [row] = await db.select({ id: locations.id }).from(locations).where(eq(locations.merchantId, merchantId)).orderBy(asc(locations.createdAt)).limit(1);
  return row?.id ?? null;
}

// ── API keys (POS integrations) ────────────────────────────────────────────

export async function insertApiKey(db: Db, input: { merchantId: string; name: string; prefix: string; keyHash: string; scopes: string[]; createdBy: string | null }) {
  const [row] = await db.insert(apiKeys).values(input).returning();
  return row!;
}

export async function listApiKeys(db: Db, merchantId: string) {
  return db.select().from(apiKeys).where(eq(apiKeys.merchantId, merchantId)).orderBy(asc(apiKeys.createdAt));
}

export async function findActiveApiKey(db: Db, keyHash: string) {
  const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)));
  return row ?? null;
}

export async function touchApiKey(db: Db, id: string, at: Date) {
  await db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, id));
}

export async function revokeApiKey(db: Db, merchantId: string, id: string, at: Date) {
  await db.update(apiKeys).set({ revokedAt: at }).where(and(eq(apiKeys.id, id), eq(apiKeys.merchantId, merchantId)));
}

// ── Webhook idempotency ─────────────────────────────────────────────────────

/** Returns true the first time an event is seen; false for duplicates. */
export async function recordWebhookEvent(
  db: Db,
  input: { source: "whatsapp" | "pos"; externalId: string; merchantId: string | null; payload: unknown },
): Promise<{ isNew: boolean; id: string | null }> {
  const rows = await db.insert(webhookEvents).values(input).onConflictDoNothing().returning({ id: webhookEvents.id });
  return { isNew: rows.length > 0, id: rows[0]?.id ?? null };
}

export async function markWebhookProcessed(db: Db, id: string, at: Date, error: string | null = null) {
  await db.update(webhookEvents).set({ processedAt: at, error }).where(eq(webhookEvents.id, id));
}
