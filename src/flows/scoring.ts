import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { daysBetween, DAY_MS } from "@/core/time";
import type { Db } from "@/server/db";
import { listEntitlementsForCustomer } from "@/modules/anchors/repo";
import { remainingRetailCents } from "@/modules/anchors/ledger";
import { computeAggregates } from "@/modules/customers/aggregates";
import { getCustomer, listAllCustomers, saveAggregates, saveScore, type CustomerWithPromo } from "@/modules/customers/repo";
import { customers } from "@/modules/customers/schema";
import type { DealCustomer } from "@/modules/deals/types";
import type { MerchantContext } from "@/modules/merchants/repo";
import { sentRemindersForCustomer } from "@/modules/messaging/repo";
import { baselineFeatures, computeReturnScore, percentileRank, RESCORE_AFTER_HOURS, segmentFor } from "@/modules/scoring";
import type { ReturnScore, ScoreFeatures, Segment } from "@/modules/scoring/types";
import { visitFactsForCustomer } from "@/modules/visits/repo";

/**
 * Customer snapshot: Return Score features, score, segment and the deal-engine view of a
 * customer. Everything here is derived from stored facts so it can be recomputed at any
 * time (scheduler, visit close, checkout).
 */

/** Average visit spend of every active customer with history, ascending (for percentiles). */
export async function spendDistribution(db: Db, merchantId: string): Promise<number[]> {
  const all = await listAllCustomers(db, merchantId);
  return all
    .filter((c) => c.visitCount > 0)
    .map((c) => c.totalSpendCents / c.visitCount)
    .sort((a, b) => a - b);
}

export async function buildScoreFeatures(db: Db, customer: CustomerWithPromo, now: Date, spendSorted: number[]): Promise<ScoreFeatures> {
  const facts = await visitFactsForCustomer(db, customer.id);
  const since90 = now.getTime() - 90 * DAY_MS;
  const active = await listEntitlementsForCustomer(db, customer.id, ["active"]);
  const expiries = active
    .map((e) => e.expiresAt)
    .filter((d): d is Date => d !== null && d.getTime() > now.getTime())
    .map((d) => daysBetween(now, d));

  // Reminder response: share of sent reminders followed by a visit within 14 days.
  const reminders = (await sentRemindersForCustomer(db, customer.id)).map((r) => r.sentAt).filter((d): d is Date => d !== null);
  const responded = reminders.filter((sent) =>
    facts.some((v) => v.openedAt.getTime() > sent.getTime() && v.openedAt.getTime() - sent.getTime() <= 14 * DAY_MS),
  ).length;

  const avgSpend = customer.visitCount > 0 ? customer.totalSpendCents / customer.visitCount : 0;
  return {
    visitCount: customer.visitCount,
    visits90: facts.filter((v) => v.openedAt.getTime() >= since90).length,
    daysSinceLastVisit: customer.lastVisitAt ? Math.max(0, daysBetween(customer.lastVisitAt, now)) : null,
    typicalGapDays: customer.typicalGapDays,
    tenureDays: customer.firstVisitAt ? Math.max(0, daysBetween(customer.firstVisitAt, now)) : 0,
    spendPercentile: customer.visitCount > 0 ? percentileRank(spendSorted, avgSpend) : 0.5,
    avgPartySize: customer.avgPartySize,
    activeEntitlementValueCents: active.reduce((s, e) => s + remainingRetailCents(e), 0),
    daysToNearestExpiry: expiries.length > 0 ? Math.min(...expiries) : null,
    messageResponseRate: reminders.length > 0 ? responded / reminders.length : null,
    promoShare: customer.visitCount > 0 ? customer.promoVisitCount / customer.visitCount : 0,
  };
}

export interface CustomerSnapshot {
  customer: CustomerWithPromo;
  features: ScoreFeatures;
  score: ReturnScore;
  segment: Segment;
  /** Return probability WITHOUT anchors (deal-engine baseline). */
  p0: number;
}

export async function customerSnapshot(
  db: Db,
  merchant: MerchantContext,
  customerId: string,
  now: Date,
  spendSorted?: number[],
): Promise<CustomerSnapshot> {
  const customer = await getCustomer(db, merchant.merchant.id, customerId);
  const features = await buildScoreFeatures(db, customer, now, spendSorted ?? (await spendDistribution(db, merchant.merchant.id)));
  const score = computeReturnScore(features);
  const segment = segmentFor(features, score.probability, merchant.settings.messaging.winBackAfterDays);
  const p0 = computeReturnScore(baselineFeatures(features)).probability;
  return { customer, features, score, segment, p0 };
}

/** Recompute and store a customer's Return Score and segment. */
export async function rescoreCustomer(
  db: Db,
  merchant: MerchantContext,
  customerId: string,
  now: Date,
  spendSorted?: number[],
): Promise<CustomerSnapshot> {
  const snap = await customerSnapshot(db, merchant, customerId, now, spendSorted);
  await saveScore(db, customerId, { probability: snap.score.probability, band: snap.score.band, segment: snap.segment, factors: snap.score.factors }, now);
  return snap;
}

/** Recompute visit aggregates (counts, spend, habits) from closed visits, then rescore. */
export async function refreshCustomer(db: Db, merchant: MerchantContext, customerId: string, now: Date): Promise<CustomerSnapshot> {
  const facts = await visitFactsForCustomer(db, customerId);
  const aggregates = computeAggregates(facts, merchant.merchant.timezone);
  await saveAggregates(db, customerId, aggregates, now);
  return rescoreCustomer(db, merchant, customerId, now);
}

/** The deal engine's view of an identified customer. */
export function dealCustomerFrom(snap: CustomerSnapshot): DealCustomer {
  const c = snap.customer;
  return {
    p0: snap.p0,
    segment: snap.segment,
    visitCount: c.visitCount,
    avgVisitGpCents: c.visitCount > 0 ? Math.round(c.totalGpCents / c.visitCount) : null,
    avgVisitSpendCents: c.visitCount > 0 ? Math.round(c.totalSpendCents / c.visitCount) : null,
  };
}

/** Rescore customers whose score is missing or older than RESCORE_AFTER_HOURS. */
export async function rescoreStale(db: Db, merchant: MerchantContext, now: Date, limit = 300): Promise<number> {
  const staleBefore = new Date(now.getTime() - RESCORE_AFTER_HOURS * 3_600_000);
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.merchantId, merchant.merchant.id),
        eq(customers.status, "active"),
        or(isNull(customers.scoredAt), lt(customers.scoredAt, staleBefore)),
      ),
    )
    .limit(limit);
  if (rows.length === 0) return 0;
  const spendSorted = await spendDistribution(db, merchant.merchant.id);
  for (const row of rows) await rescoreCustomer(db, merchant, row.id, now, spendSorted);
  return rows.length;
}
