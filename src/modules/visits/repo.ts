import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { NotFoundError } from "@/core/errors";
import type { Db } from "@/server/db";
import type { VisitFact } from "../customers/types";
import { visitLines, visits } from "./schema";
import type { LineType, Visit, VisitLine, VisitSource } from "./types";

type VisitRow = typeof visits.$inferSelect;
type LineRow = typeof visitLines.$inferSelect;

export const toVisit = (row: VisitRow): Visit => ({ ...row });
export const toLine = (row: LineRow): VisitLine => ({ ...row });

export async function insertVisit(
  db: Db,
  input: {
    merchantId: string;
    locationId?: string | null;
    customerId?: string | null;
    partySize: number;
    source?: VisitSource;
    externalRef?: string | null;
    label?: string | null;
    openedByUserId?: string | null;
    openedAt: Date;
  },
): Promise<Visit> {
  const [row] = await db
    .insert(visits)
    .values({
      merchantId: input.merchantId,
      locationId: input.locationId ?? null,
      customerId: input.customerId ?? null,
      partySize: Math.max(1, Math.round(input.partySize)),
      source: input.source ?? "staff",
      externalRef: input.externalRef ?? null,
      label: input.label ?? null,
      openedByUserId: input.openedByUserId ?? null,
      openedAt: input.openedAt,
    })
    .returning();
  return toVisit(row!);
}

export async function getVisit(db: Db, merchantId: string, id: string, options: { forUpdate?: boolean } = {}): Promise<Visit> {
  const query = db.select().from(visits).where(and(eq(visits.id, id), eq(visits.merchantId, merchantId)));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new NotFoundError("Visit not found.");
  return toVisit(row);
}

export async function findVisitByExternalRef(db: Db, merchantId: string, externalRef: string): Promise<Visit | null> {
  const [row] = await db.select().from(visits).where(and(eq(visits.merchantId, merchantId), eq(visits.externalRef, externalRef)));
  return row ? toVisit(row) : null;
}

export async function listLines(db: Db, visitId: string, options: { includeVoided?: boolean } = {}): Promise<VisitLine[]> {
  const where = options.includeVoided ? eq(visitLines.visitId, visitId) : and(eq(visitLines.visitId, visitId), isNull(visitLines.voidedAt));
  const rows = await db.select().from(visitLines).where(where).orderBy(asc(visitLines.createdAt));
  return rows.map(toLine);
}

export async function insertLine(
  db: Db,
  input: {
    merchantId: string;
    visitId: string;
    itemId?: string | null;
    name: string;
    category: string;
    quantity: number;
    unitPriceCents: number;
    unitCostCents: number;
    lineType: LineType;
    entitlementId?: string | null;
    offerExposureId?: string | null;
    at: Date;
  },
): Promise<VisitLine> {
  const [row] = await db
    .insert(visitLines)
    .values({
      merchantId: input.merchantId,
      visitId: input.visitId,
      itemId: input.itemId ?? null,
      name: input.name,
      category: input.category,
      quantity: input.quantity,
      unitPriceCents: input.unitPriceCents,
      unitCostCents: input.unitCostCents,
      lineType: input.lineType,
      entitlementId: input.entitlementId ?? null,
      offerExposureId: input.offerExposureId ?? null,
      createdAt: input.at,
    })
    .returning();
  return toLine(row!);
}

export async function getLine(db: Db, merchantId: string, lineId: string): Promise<VisitLine> {
  const [row] = await db.select().from(visitLines).where(and(eq(visitLines.id, lineId), eq(visitLines.merchantId, merchantId)));
  if (!row) throw new NotFoundError("Line not found.");
  return toLine(row);
}

export async function voidLineRow(db: Db, lineId: string, at: Date) {
  await db.update(visitLines).set({ voidedAt: at }).where(eq(visitLines.id, lineId));
}

/** Void all regular lines of a POS visit before re-importing an updated bill. */
export async function voidRegularLines(db: Db, visitId: string, at: Date) {
  await db
    .update(visitLines)
    .set({ voidedAt: at })
    .where(and(eq(visitLines.visitId, visitId), eq(visitLines.lineType, "regular"), isNull(visitLines.voidedAt)));
}

export async function updateVisit(
  db: Db,
  visitId: string,
  patch: Partial<Pick<Visit, "customerId" | "partySize" | "label" | "status" | "closedAt">>,
) {
  await db.update(visits).set(patch).where(eq(visits.id, visitId));
}

export async function listVisits(
  db: Db,
  merchantId: string,
  options: { status?: Visit["status"]; customerId?: string; since?: Date; limit?: number } = {},
): Promise<Visit[]> {
  const conditions = [eq(visits.merchantId, merchantId)];
  if (options.status) conditions.push(eq(visits.status, options.status));
  if (options.customerId) conditions.push(eq(visits.customerId, options.customerId));
  if (options.since) conditions.push(gte(visits.openedAt, options.since));
  const rows = await db
    .select()
    .from(visits)
    .where(and(...conditions))
    .orderBy(desc(visits.openedAt))
    .limit(options.limit ?? 200);
  return rows.map(toVisit);
}

export async function listLinesForVisits(db: Db, visitIds: string[]): Promise<VisitLine[]> {
  if (visitIds.length === 0) return [];
  const rows = await db
    .select()
    .from(visitLines)
    .where(and(inArray(visitLines.visitId, visitIds), isNull(visitLines.voidedAt)))
    .orderBy(asc(visitLines.createdAt));
  return rows.map(toLine);
}

/** Closed-visit facts for one customer (spend, GP, promo use) for aggregate recomputation. */
export async function visitFactsForCustomer(db: Db, customerId: string): Promise<(VisitFact & { visitId: string })[]> {
  const rows = await db
    .select({
      visitId: visits.id,
      openedAt: visits.openedAt,
      partySize: visits.partySize,
      revenue: sql<number>`coalesce(sum(${visitLines.unitPriceCents} * ${visitLines.quantity}) filter (where ${visitLines.voidedAt} is null), 0)::int`,
      cost: sql<number>`coalesce(sum(${visitLines.unitCostCents} * ${visitLines.quantity}) filter (where ${visitLines.voidedAt} is null), 0)::int`,
      promo: sql<boolean>`coalesce(bool_or(${visitLines.lineType} in ('perk', 'discount') and ${visitLines.voidedAt} is null), false)`,
    })
    .from(visits)
    .leftJoin(visitLines, eq(visitLines.visitId, visits.id))
    .where(and(eq(visits.customerId, customerId), eq(visits.status, "closed")))
    .groupBy(visits.id)
    .orderBy(asc(visits.openedAt));
  return rows.map((r) => ({
    visitId: r.visitId,
    openedAt: r.openedAt,
    partySize: r.partySize,
    spendCents: Number(r.revenue),
    gpCents: Number(r.revenue) - Number(r.cost),
    promo: Boolean(r.promo),
  }));
}

/** Merchant baseline: average spend and GP per closed visit over a recent window. */
export async function merchantVisitBaseline(db: Db, merchantId: string, since: Date, until: Date) {
  const perVisit = db
    .select({
      revenue: sql<number>`coalesce(sum(${visitLines.unitPriceCents} * ${visitLines.quantity}) filter (where ${visitLines.voidedAt} is null and ${visitLines.lineType} = 'regular'), 0)`.as("revenue"),
      cost: sql<number>`coalesce(sum(${visitLines.unitCostCents} * ${visitLines.quantity}) filter (where ${visitLines.voidedAt} is null and ${visitLines.lineType} = 'regular'), 0)`.as("cost"),
    })
    .from(visits)
    .leftJoin(visitLines, eq(visitLines.visitId, visits.id))
    .where(and(eq(visits.merchantId, merchantId), eq(visits.status, "closed"), gte(visits.openedAt, since), lt(visits.openedAt, until)))
    .groupBy(visits.id)
    .as("per_visit");
  const [row] = await db
    .select({
      visits: sql<number>`count(*)::int`,
      avgSpend: sql<number>`coalesce(avg(${perVisit.revenue}), 0)::float`,
      avgGp: sql<number>`coalesce(avg(${perVisit.revenue} - ${perVisit.cost}), 0)::float`,
    })
    .from(perVisit);
  return { visits: Number(row?.visits ?? 0), avgSpendCents: Math.round(Number(row?.avgSpend ?? 0)), avgGpCents: Math.round(Number(row?.avgGp ?? 0)) };
}

/** Per-category share of a customer's past regular purchases (for upsell affinity). */
export async function categoryAffinity(db: Db, customerId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ category: visitLines.category, qty: sql<number>`sum(${visitLines.quantity})::int` })
    .from(visitLines)
    .innerJoin(visits, eq(visits.id, visitLines.visitId))
    .where(and(eq(visits.customerId, customerId), eq(visitLines.lineType, "regular"), isNull(visitLines.voidedAt)))
    .groupBy(visitLines.category);
  const total = rows.reduce((s, r) => s + Number(r.qty), 0);
  if (total === 0) return {};
  return Object.fromEntries(rows.map((r) => [r.category, Number(r.qty) / total]));
}
