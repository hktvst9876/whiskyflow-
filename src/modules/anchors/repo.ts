import "server-only";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { NotFoundError } from "@/core/errors";
import type { Db } from "@/server/db";
import { anchorPrograms, entitlementEvents, entitlements } from "./schema";
import type { AnchorProgram, AnchorProgramInput, Entitlement, EntitlementEvent, EntitlementStatus } from "./types";

type ProgramRow = typeof anchorPrograms.$inferSelect;
type EntitlementRow = typeof entitlements.$inferSelect;

export const toProgram = (row: ProgramRow): AnchorProgram => ({ ...row });

export type EntitlementRecord = Entitlement & { claimTokenHash: string | null };

export function toEntitlement(row: EntitlementRow): EntitlementRecord {
  return { ...row };
}

export const toEvent = (row: typeof entitlementEvents.$inferSelect): EntitlementEvent => ({ ...row });

// ── Programs ───────────────────────────────────────────────────────────────

export async function listPrograms(db: Db, merchantId: string, options: { status?: AnchorProgram["status"] } = {}) {
  const where = options.status
    ? and(eq(anchorPrograms.merchantId, merchantId), eq(anchorPrograms.status, options.status))
    : eq(anchorPrograms.merchantId, merchantId);
  const rows = await db.select().from(anchorPrograms).where(where).orderBy(asc(anchorPrograms.createdAt));
  return rows.map(toProgram);
}

export async function getProgram(db: Db, merchantId: string, id: string) {
  const [row] = await db.select().from(anchorPrograms).where(and(eq(anchorPrograms.id, id), eq(anchorPrograms.merchantId, merchantId)));
  if (!row) throw new NotFoundError("Anchor program not found.");
  return toProgram(row);
}

export async function insertProgram(db: Db, merchantId: string, input: AnchorProgramInput, at: Date) {
  const [row] = await db
    .insert(anchorPrograms)
    .values({ ...input, merchantId, createdAt: at, updatedAt: at })
    .returning();
  return toProgram(row!);
}

export async function updateProgram(db: Db, merchantId: string, id: string, patch: Partial<AnchorProgramInput>, at: Date) {
  const [row] = await db
    .update(anchorPrograms)
    .set({ ...patch, updatedAt: at })
    .where(and(eq(anchorPrograms.id, id), eq(anchorPrograms.merchantId, merchantId)))
    .returning();
  if (!row) throw new NotFoundError("Anchor program not found.");
  return toProgram(row);
}

// ── Entitlements ───────────────────────────────────────────────────────────

export async function getEntitlement(db: Db, merchantId: string, id: string, options: { forUpdate?: boolean } = {}) {
  const query = db.select().from(entitlements).where(and(eq(entitlements.id, id), eq(entitlements.merchantId, merchantId)));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new NotFoundError("Anchor not found.");
  return toEntitlement(row);
}

export async function findEntitlementByClaimHash(db: Db, claimTokenHash: string, options: { forUpdate?: boolean } = {}) {
  const query = db.select().from(entitlements).where(eq(entitlements.claimTokenHash, claimTokenHash));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  return row ? toEntitlement(row) : null;
}

export async function listEntitlementsForCustomer(db: Db, customerId: string, statuses?: EntitlementStatus[]) {
  const where = statuses
    ? and(eq(entitlements.customerId, customerId), inArray(entitlements.status, statuses))
    : eq(entitlements.customerId, customerId);
  const rows = await db.select().from(entitlements).where(where).orderBy(desc(entitlements.createdAt));
  return rows.map(toEntitlement);
}

export async function listEntitlementsForCustomers(db: Db, customerIds: string[], statuses: EntitlementStatus[]) {
  if (customerIds.length === 0) return [];
  const rows = await db
    .select()
    .from(entitlements)
    .where(and(inArray(entitlements.customerId, customerIds), inArray(entitlements.status, statuses)));
  return rows.map(toEntitlement);
}

export async function listEntitlements(
  db: Db,
  merchantId: string,
  options: { statuses?: EntitlementStatus[]; originVisitId?: string; limit?: number } = {},
) {
  const conditions = [eq(entitlements.merchantId, merchantId)];
  if (options.statuses) conditions.push(inArray(entitlements.status, options.statuses));
  if (options.originVisitId) conditions.push(eq(entitlements.originVisitId, options.originVisitId));
  const rows = await db
    .select()
    .from(entitlements)
    .where(and(...conditions))
    .orderBy(desc(entitlements.createdAt))
    .limit(options.limit ?? 500);
  return rows.map(toEntitlement);
}

/** Open anchors whose expiry has passed (for the scheduler). */
export async function listDueForExpiry(db: Db, now: Date, limit = 500) {
  const rows = await db
    .select()
    .from(entitlements)
    .where(and(inArray(entitlements.status, ["pending_claim", "active"]), lte(entitlements.expiresAt, now)))
    .limit(limit);
  return rows.map(toEntitlement);
}

export async function listEvents(db: Db, entitlementId: string) {
  const rows = await db.select().from(entitlementEvents).where(eq(entitlementEvents.entitlementId, entitlementId)).orderBy(asc(entitlementEvents.createdAt));
  return rows.map(toEvent);
}

export async function listEventsForEntitlements(db: Db, entitlementIds: string[]) {
  if (entitlementIds.length === 0) return [];
  const rows = await db
    .select()
    .from(entitlementEvents)
    .where(inArray(entitlementEvents.entitlementId, entitlementIds))
    .orderBy(asc(entitlementEvents.createdAt));
  return rows.map(toEvent);
}

/** Retail value of everything still owed to customers (open anchors). */
export async function outstandingLiabilityCents(db: Db, merchantId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(case when ${entitlements.unitType} = 'percent'
        then ${entitlements.unitRetailCents} * ${entitlements.quantityRemaining} / 100
        else ${entitlements.unitRetailCents} * ${entitlements.quantityRemaining} end), 0)::bigint`,
    })
    .from(entitlements)
    .where(and(eq(entitlements.merchantId, merchantId), inArray(entitlements.status, ["pending_claim", "active"])));
  return Number(row?.total ?? 0);
}

export async function openAnchorCount(db: Db, customerId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(entitlements)
    .where(and(eq(entitlements.customerId, customerId), inArray(entitlements.status, ["pending_claim", "active"])));
  return Number(row?.n ?? 0);
}
