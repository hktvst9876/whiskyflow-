import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { NotFoundError } from "@/core/errors";
import { newId, randomCode } from "@/core/ids";
import { derivedToken, sha256 } from "@/server/crypto";
import type { Db } from "@/server/db";
import type { Segment } from "../scoring/types";
import { REDEEM_CODE_LENGTH } from "./config";
import { customerConsents, customers, walletTokens } from "./schema";
import type { ConsentPurpose, ConsentSource, Customer } from "./types";

type Row = typeof customers.$inferSelect;

export function toCustomer(row: Row): Customer {
  return {
    id: row.id,
    merchantId: row.merchantId,
    phoneE164: row.phoneE164,
    displayName: row.displayName,
    redeemCode: row.redeemCode,
    status: row.status,
    firstVisitAt: row.firstVisitAt,
    lastVisitAt: row.lastVisitAt,
    visitCount: row.visitCount,
    totalSpendCents: row.totalSpendCents,
    totalGpCents: row.totalGpCents,
    avgPartySize: row.avgPartySizeX10 / 10,
    preferredWeekday: row.preferredWeekday,
    preferredHour: row.preferredHour,
    typicalGapDays: row.typicalGapDays,
    whatsappServiceOptIn: row.whatsappServiceOptIn,
    whatsappMarketingOptIn: row.whatsappMarketingOptIn,
    optedOutAt: row.optedOutAt,
    returnProbability: row.returnProbabilityBp === null ? null : row.returnProbabilityBp / 10_000,
    returnBand: row.returnBand,
    segment: row.segment,
    scoreFactors: row.scoreFactors,
    scoredAt: row.scoredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type CustomerWithPromo = Customer & { promoVisitCount: number };

function withPromo(row: Row): CustomerWithPromo {
  return { ...toCustomer(row), promoVisitCount: row.promoVisitCount };
}

export async function getCustomer(db: Db, merchantId: string, id: string): Promise<CustomerWithPromo> {
  const [row] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.merchantId, merchantId)));
  if (!row) throw new NotFoundError("Customer not found.");
  return withPromo(row);
}

export async function findCustomerByPhone(db: Db, merchantId: string, phoneE164: string): Promise<CustomerWithPromo | null> {
  const [row] = await db.select().from(customers).where(and(eq(customers.merchantId, merchantId), eq(customers.phoneE164, phoneE164)));
  return row ? withPromo(row) : null;
}

export async function findCustomerByRedeemCode(db: Db, merchantId: string, code: string): Promise<CustomerWithPromo | null> {
  const [row] = await db.select().from(customers).where(and(eq(customers.merchantId, merchantId), eq(customers.redeemCode, code)));
  return row ? withPromo(row) : null;
}

/** Create a customer with a unique redeem code (retries on the rare collision). */
export async function insertCustomer(
  db: Db,
  input: { merchantId: string; phoneE164: string | null; displayName?: string | null; at: Date },
): Promise<CustomerWithPromo> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await db
      .insert(customers)
      .values({
        merchantId: input.merchantId,
        phoneE164: input.phoneE164,
        displayName: input.displayName ?? null,
        redeemCode: randomCode(REDEEM_CODE_LENGTH),
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onConflictDoNothing({ target: [customers.merchantId, customers.redeemCode] })
      .returning();
    if (rows[0]) return withPromo(rows[0]);
  }
  throw new Error("Could not allocate a unique redeem code.");
}

export interface AggregatePatch {
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  visitCount: number;
  totalSpendCents: number;
  totalGpCents: number;
  avgPartySize: number;
  preferredWeekday: number | null;
  preferredHour: number | null;
  typicalGapDays: number | null;
  promoVisitCount: number;
}

export async function saveAggregates(db: Db, customerId: string, a: AggregatePatch, at: Date) {
  await db
    .update(customers)
    .set({
      firstVisitAt: a.firstVisitAt,
      lastVisitAt: a.lastVisitAt,
      visitCount: a.visitCount,
      totalSpendCents: a.totalSpendCents,
      totalGpCents: a.totalGpCents,
      avgPartySizeX10: Math.round(a.avgPartySize * 10),
      preferredWeekday: a.preferredWeekday,
      preferredHour: a.preferredHour,
      typicalGapDays: a.typicalGapDays,
      promoVisitCount: a.promoVisitCount,
      updatedAt: at,
    })
    .where(eq(customers.id, customerId));
}

export async function saveScore(
  db: Db,
  customerId: string,
  score: { probability: number; band: Customer["returnBand"]; segment: Segment; factors: Customer["scoreFactors"] },
  at: Date,
) {
  await db
    .update(customers)
    .set({
      returnProbabilityBp: Math.round(score.probability * 10_000),
      returnBand: score.band,
      segment: score.segment,
      scoreFactors: score.factors,
      scoredAt: at,
    })
    .where(eq(customers.id, customerId));
}

export async function updateCustomerName(db: Db, customerId: string, displayName: string | null, at: Date) {
  await db.update(customers).set({ displayName, updatedAt: at }).where(eq(customers.id, customerId));
}

/**
 * Record a consent decision (append-only log) and update the current flags.
 * Opting out of marketing sets `opted_out_at`; opting back in clears it.
 */
export async function recordConsent(
  db: Db,
  input: { merchantId: string; customerId: string; purpose: ConsentPurpose; granted: boolean; source: ConsentSource; noticeVersion: string; at: Date },
) {
  await db.insert(customerConsents).values({
    merchantId: input.merchantId,
    customerId: input.customerId,
    purpose: input.purpose,
    granted: input.granted,
    source: input.source,
    noticeVersion: input.noticeVersion,
    createdAt: input.at,
  });
  if (input.purpose === "service_messages") {
    await db.update(customers).set({ whatsappServiceOptIn: input.granted, updatedAt: input.at }).where(eq(customers.id, input.customerId));
  } else if (input.purpose === "marketing_messages") {
    await db
      .update(customers)
      .set({ whatsappMarketingOptIn: input.granted, optedOutAt: input.granted ? null : input.at, updatedAt: input.at })
      .where(eq(customers.id, input.customerId));
  }
}

export async function listConsents(db: Db, customerId: string) {
  return db.select().from(customerConsents).where(eq(customerConsents.customerId, customerId)).orderBy(desc(customerConsents.createdAt));
}

// ── Wallet links ───────────────────────────────────────────────────────────

/** Current wallet token for a customer, creating one if needed. Token = HMAC(secret, row id). */
export async function walletTokenFor(db: Db, merchantId: string, customerId: string, at: Date): Promise<string> {
  const [existing] = await db
    .select({ id: walletTokens.id })
    .from(walletTokens)
    .where(and(eq(walletTokens.customerId, customerId), isNull(walletTokens.revokedAt)))
    .orderBy(desc(walletTokens.createdAt))
    .limit(1);
  if (existing) return derivedToken("wallet", existing.id);
  const id = newId();
  const token = derivedToken("wallet", id);
  await db.insert(walletTokens).values({ id, merchantId, customerId, tokenHash: sha256(token), createdAt: at });
  return token;
}

export async function findWalletToken(db: Db, token: string) {
  const [row] = await db
    .select()
    .from(walletTokens)
    .where(and(eq(walletTokens.tokenHash, sha256(token)), isNull(walletTokens.revokedAt)));
  return row ?? null;
}

export async function touchWalletToken(db: Db, id: string, at: Date) {
  await db.update(walletTokens).set({ lastUsedAt: at }).where(eq(walletTokens.id, id));
}

export async function revokeWalletTokens(db: Db, customerId: string, at: Date) {
  await db.update(walletTokens).set({ revokedAt: at }).where(and(eq(walletTokens.customerId, customerId), isNull(walletTokens.revokedAt)));
}

/** Privacy request: remove identity, keep anonymous visit facts for aggregate reporting. */
export async function anonymiseCustomer(db: Db, customerId: string, at: Date) {
  await db
    .update(customers)
    .set({
      phoneE164: null,
      displayName: null,
      status: "anonymised",
      whatsappServiceOptIn: false,
      whatsappMarketingOptIn: false,
      optedOutAt: at,
      scoreFactors: null,
      updatedAt: at,
    })
    .where(eq(customers.id, customerId));
  await revokeWalletTokens(db, customerId, at);
}

// ── Lists ──────────────────────────────────────────────────────────────────

export async function listCustomerRows(
  db: Db,
  merchantId: string,
  options: { segment?: Segment | null; search?: string | null; limit?: number; offset?: number } = {},
) {
  const conditions: SQL[] = [eq(customers.merchantId, merchantId), eq(customers.status, "active")];
  if (options.segment) conditions.push(eq(customers.segment, options.segment));
  if (options.search) {
    const q = `%${options.search.trim()}%`;
    conditions.push(or(ilike(customers.displayName, q), ilike(customers.phoneE164, q), ilike(customers.redeemCode, q))!);
  }
  const rows = await db
    .select()
    .from(customers)
    .where(and(...conditions))
    .orderBy(sql`${customers.lastVisitAt} desc nulls last`, asc(customers.createdAt))
    .limit(options.limit ?? 200)
    .offset(options.offset ?? 0);
  return rows.map(withPromo);
}

export async function listAllCustomers(db: Db, merchantId: string) {
  const rows = await db.select().from(customers).where(and(eq(customers.merchantId, merchantId), eq(customers.status, "active")));
  return rows.map(withPromo);
}
