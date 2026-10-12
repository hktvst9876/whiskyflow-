import "server-only";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { NotFoundError } from "@/core/errors";
import type { Db } from "@/server/db";
import { offerDecisions, offerDefinitions, offerExposures } from "./schema";
import type { ExposureFact, ExposureStatus, OfferDecision, OfferDefinition, OfferExposure } from "./types";

export const toDefinition = (row: typeof offerDefinitions.$inferSelect): OfferDefinition => ({ ...row });
export const toDecision = (row: typeof offerDecisions.$inferSelect): OfferDecision => ({ ...row, candidates: row.candidates ?? [] });
export const toExposure = (row: typeof offerExposures.$inferSelect): OfferExposure => ({ ...row });

// ── Definitions ────────────────────────────────────────────────────────────

export async function listDefinitions(db: Db, merchantId: string, options: { status?: OfferDefinition["status"] } = {}) {
  const where = options.status
    ? and(eq(offerDefinitions.merchantId, merchantId), eq(offerDefinitions.status, options.status))
    : eq(offerDefinitions.merchantId, merchantId);
  const rows = await db.select().from(offerDefinitions).where(where).orderBy(asc(offerDefinitions.createdAt));
  return rows.map(toDefinition);
}

export async function getDefinition(db: Db, merchantId: string, id: string) {
  const [row] = await db.select().from(offerDefinitions).where(and(eq(offerDefinitions.id, id), eq(offerDefinitions.merchantId, merchantId)));
  if (!row) throw new NotFoundError("Offer not found.");
  return toDefinition(row);
}

export async function insertDefinition(
  db: Db,
  input: Pick<OfferDefinition, "merchantId" | "offerType" | "name" | "isDiscount" | "config" | "estCostCents"> & { at: Date },
) {
  const [row] = await db
    .insert(offerDefinitions)
    .values({ ...input, createdAt: input.at, updatedAt: input.at })
    .returning();
  return toDefinition(row!);
}

export async function updateDefinition(
  db: Db,
  merchantId: string,
  id: string,
  patch: Partial<Pick<OfferDefinition, "name" | "status" | "isDiscount" | "config" | "estCostCents">>,
  at: Date,
) {
  const [row] = await db
    .update(offerDefinitions)
    .set({ ...patch, updatedAt: at })
    .where(and(eq(offerDefinitions.id, id), eq(offerDefinitions.merchantId, merchantId)))
    .returning();
  if (!row) throw new NotFoundError("Offer not found.");
  return toDefinition(row);
}

// ── Decisions (one per visit, never re-rolled) ────────────────────────────

export async function getDecisionForVisit(db: Db, visitId: string): Promise<OfferDecision | null> {
  const [row] = await db.select().from(offerDecisions).where(eq(offerDecisions.visitId, visitId));
  return row ? toDecision(row) : null;
}

export async function getDecision(db: Db, merchantId: string, id: string): Promise<OfferDecision> {
  const [row] = await db.select().from(offerDecisions).where(and(eq(offerDecisions.id, id), eq(offerDecisions.merchantId, merchantId)));
  if (!row) throw new NotFoundError("Offer decision not found.");
  return toDecision(row);
}

/** Insert the visit's decision; if another request won the race, return theirs. */
export async function insertDecisionOnce(
  db: Db,
  input: Omit<OfferDecision, "id" | "createdAt"> & { at: Date },
): Promise<{ decision: OfferDecision; created: boolean }> {
  const { at, ...values } = input;
  const rows = await db
    .insert(offerDecisions)
    .values({ ...values, createdAt: at })
    .onConflictDoNothing({ target: offerDecisions.visitId })
    .returning();
  if (rows[0]) return { decision: toDecision(rows[0]), created: true };
  const existing = await getDecisionForVisit(db, input.visitId);
  if (!existing) throw new Error("Decision insert conflicted but no decision exists.");
  return { decision: existing, created: false };
}

// ── Exposures ──────────────────────────────────────────────────────────────

export async function insertExposure(db: Db, input: Omit<OfferExposure, "id" | "respondedAt"> & { respondedAt?: Date | null }) {
  const [row] = await db.insert(offerExposures).values(input).returning();
  return toExposure(row!);
}

export async function getExposure(db: Db, merchantId: string, id: string, options: { forUpdate?: boolean } = {}) {
  const query = db.select().from(offerExposures).where(and(eq(offerExposures.id, id), eq(offerExposures.merchantId, merchantId)));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new NotFoundError("Offer not found.");
  return toExposure(row);
}

export async function updateExposure(
  db: Db,
  id: string,
  patch: Partial<Pick<OfferExposure, "status" | "respondedAt" | "visitId" | "entitlementId" | "messageId" | "valueCents" | "promoCostCents" | "customerId">>,
) {
  await db.update(offerExposures).set(patch).where(eq(offerExposures.id, id));
}

export async function exposuresForDecision(db: Db, decisionId: string) {
  const rows = await db.select().from(offerExposures).where(eq(offerExposures.decisionId, decisionId)).orderBy(asc(offerExposures.shownAt));
  return rows.map(toExposure);
}

export async function exposuresForVisit(db: Db, visitId: string) {
  const rows = await db.select().from(offerExposures).where(eq(offerExposures.visitId, visitId)).orderBy(asc(offerExposures.shownAt));
  return rows.map(toExposure);
}

/** Facts for guardrails: this customer's offer history over the last year. */
export async function exposureFactsForCustomer(db: Db, customerId: string, now: Date): Promise<ExposureFact[]> {
  const since = new Date(now.getTime() - 365 * 86_400_000);
  return db
    .select({
      offerType: offerExposures.offerType,
      isDiscount: offerExposures.isDiscount,
      status: offerExposures.status,
      channel: offerExposures.channel,
      promoCostCents: offerExposures.promoCostCents,
      shownAt: offerExposures.shownAt,
    })
    .from(offerExposures)
    .where(and(eq(offerExposures.customerId, customerId), gte(offerExposures.shownAt, since)))
    .orderBy(desc(offerExposures.shownAt));
}

/** Promotions sent to the customer that are still usable at the till. */
export async function usableExposuresForCustomer(db: Db, customerId: string, now: Date) {
  const rows = await db
    .select()
    .from(offerExposures)
    .where(
      and(
        eq(offerExposures.customerId, customerId),
        eq(offerExposures.status, "shown"),
        inArray(offerExposures.channel, ["whatsapp", "wallet"]),
        or(isNull(offerExposures.expiresAt), gt(offerExposures.expiresAt, now)),
      ),
    )
    .orderBy(desc(offerExposures.shownAt));
  return rows.map(toExposure);
}

/** Mark promotions past their expiry as expired (scheduler). */
export async function expireExposures(db: Db, now: Date): Promise<number> {
  const rows = await db
    .update(offerExposures)
    .set({ status: "expired" as ExposureStatus })
    .where(and(eq(offerExposures.status, "shown"), lte(offerExposures.expiresAt, now)))
    .returning({ id: offerExposures.id });
  return rows.length;
}
