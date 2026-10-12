import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { NotFoundError } from "@/core/errors";
import type { Db } from "@/server/db";
import { catalogItems } from "./schema";
import type { CatalogItem, CatalogItemInput } from "./types";

type Row = typeof catalogItems.$inferSelect;

export function toItem(row: Row): CatalogItem & { sku: string | null } {
  return {
    id: row.id,
    merchantId: row.merchantId,
    name: row.name,
    category: row.category,
    kind: row.kind,
    priceCents: row.priceCents,
    costCents: row.costCents,
    active: row.active,
    anchorable: row.anchorable,
    tags: row.tags,
    description: row.description,
    sortOrder: row.sortOrder,
    sku: row.sku,
  };
}

export async function listItems(db: Db, merchantId: string, options: { activeOnly?: boolean } = {}) {
  const where = options.activeOnly
    ? and(eq(catalogItems.merchantId, merchantId), eq(catalogItems.active, true))
    : eq(catalogItems.merchantId, merchantId);
  const rows = await db.select().from(catalogItems).where(where).orderBy(asc(catalogItems.category), asc(catalogItems.sortOrder), asc(catalogItems.name));
  return rows.map(toItem);
}

export async function getItem(db: Db, merchantId: string, id: string) {
  const [row] = await db.select().from(catalogItems).where(and(eq(catalogItems.id, id), eq(catalogItems.merchantId, merchantId)));
  if (!row) throw new NotFoundError("Menu item not found.");
  return toItem(row);
}

export async function getItemsByIds(db: Db, merchantId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db.select().from(catalogItems).where(and(eq(catalogItems.merchantId, merchantId), inArray(catalogItems.id, ids)));
  return rows.map(toItem);
}

export async function insertItem(db: Db, merchantId: string, input: CatalogItemInput & { sku?: string | null }) {
  const [row] = await db
    .insert(catalogItems)
    .values({
      merchantId,
      name: input.name,
      category: input.category,
      kind: input.kind ?? "product",
      priceCents: input.priceCents,
      costCents: input.costCents,
      active: input.active ?? true,
      anchorable: input.anchorable ?? false,
      tags: input.tags ?? [],
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      sku: input.sku ?? null,
    })
    .returning();
  return toItem(row!);
}

export async function updateItem(db: Db, merchantId: string, id: string, patch: Partial<CatalogItemInput> & { sku?: string | null }, at: Date) {
  const [row] = await db
    .update(catalogItems)
    .set({ ...patch, updatedAt: at })
    .where(and(eq(catalogItems.id, id), eq(catalogItems.merchantId, merchantId)))
    .returning();
  if (!row) throw new NotFoundError("Menu item not found.");
  return toItem(row);
}

/** Match a POS line to a catalog item: SKU first, then exact name (case-insensitive). */
export async function matchItem(db: Db, merchantId: string, ref: { sku?: string | null; name: string }) {
  if (ref.sku) {
    const [row] = await db.select().from(catalogItems).where(and(eq(catalogItems.merchantId, merchantId), eq(catalogItems.sku, ref.sku)));
    if (row) return toItem(row);
  }
  const [row] = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.merchantId, merchantId), sql`lower(${catalogItems.name}) = ${ref.name.toLowerCase()}`));
  return row ? toItem(row) : null;
}
