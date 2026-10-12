import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { daysBetween, DAY_MS, localParts } from "@/core/time";
import { maskPhone } from "@/core/phone";
import { formatCode } from "@/core/ids";
import type { Db } from "@/server/db";
import { entitlementLabel } from "../anchors/labels";
import { remainingCostCents, remainingRetailCents } from "../anchors/ledger";
import { listEntitlementsForCustomers, listEvents, listEntitlementsForCustomer, outstandingLiabilityCents } from "../anchors/repo";
import { entitlements } from "../anchors/schema";
import type { EntitlementStatus } from "../anchors/types";
import { listCampaigns, listRecipients } from "../campaigns/repo";
import type { Campaign } from "../campaigns/types";
import { getCustomer, listAllCustomers, listConsents, listCustomerRows } from "../customers/repo";
import type { Segment } from "../scoring/types";
import { allAssignments, getExperimentByKey, maturedCustomerAssignments } from "../experiments/repo";
import { CHECKOUT_EXPERIMENT_KEY, type AssignmentOutcome } from "../experiments/types";
import type { MerchantContext } from "../merchants/repo";
import { listMessages } from "../messaging/repo";
import { messages } from "../messaging/schema";
import { offerExposures, offerDefinitions } from "../offers/schema";
import { nextRecommendedAction } from "../scoring/playbooks";
import { listLinesForVisits, listVisits } from "../visits/repo";
import { visitLines, visits } from "../visits/schema";
import { computeTotals } from "../visits/totals";
import type { VisitLine } from "../visits/types";
import { summariseAttribution, type AttributionSummary, type AttributionVisitRow } from "./attribution";
import { estimateLift } from "./lift";
import type { LiftEstimate } from "../experiments/types";

/**
 * Dashboard read models. Everything money-related is computed from visit lines and the
 * anchor ledger — the same facts the engines use — so the console never shows a number
 * the data cannot back up. "Attributed" numbers are always labelled as not causal; the
 * holdout lift is the causal answer.
 */

const OPEN: EntitlementStatus[] = ["pending_claim", "active"];

// ── Revenue attribution (attributed, not causal) ──────────────────────────

export async function attributionForPeriod(db: Db, merchantId: string, from: Date, to: Date): Promise<AttributionSummary & { visits: number }> {
  const closed = await db
    .select({ id: visits.id, customerId: visits.customerId })
    .from(visits)
    .where(and(eq(visits.merchantId, merchantId), eq(visits.status, "closed"), gte(visits.openedAt, from), lt(visits.openedAt, to)));
  const lines = await listLinesForVisits(db, closed.map((v) => v.id));
  const byVisit = new Map<string, VisitLine[]>();
  for (const l of lines) byVisit.set(l.visitId, [...(byVisit.get(l.visitId) ?? []), l]);
  const entIds = [...new Set(lines.filter((l) => l.lineType === "anchor_redemption" && l.entitlementId).map((l) => l.entitlementId!))];
  const ents = entIds.length
    ? await db.select({ id: entitlements.id, unitType: entitlements.unitType, unitRetailCents: entitlements.unitRetailCents }).from(entitlements).where(inArray(entitlements.id, entIds))
    : [];
  const entMap = new Map(ents.map((e) => [e.id, e]));

  const rows: AttributionVisitRow[] = closed.map((v) => {
    const vl = byVisit.get(v.id) ?? [];
    const t = computeTotals(vl);
    const redemptions = vl.filter((l) => l.lineType === "anchor_redemption");
    const redeemedRetail = redemptions.reduce((s, l) => {
      const e = l.entitlementId ? entMap.get(l.entitlementId) : undefined;
      if (!e) return s;
      return s + (e.unitType === "percent" ? Math.round((e.unitRetailCents * l.quantity) / 100) : e.unitRetailCents * l.quantity);
    }, 0);
    return {
      visitId: v.id,
      customerId: v.customerId,
      isRedemptionVisit: t.isRedemptionVisit,
      newCashRevenueCents: t.newCashRevenueCents,
      newCashCostCents: t.newCashCostCents,
      anchorUpgradeRevenueCents: t.anchorUpgradeRevenueCents,
      redemptionCostCents: t.redemptionCostCents,
      redeemedRetailCents: redeemedRetail,
      redemptionCount: redemptions.length,
      perkCostCents: t.perkCostCents,
      discountCents: t.discountCents,
    };
  });

  // Packages kept from a purchase (bottle, bucket, service package): their bill price.
  const kept = await db
    .select({ originVisitId: entitlements.originVisitId, itemId: entitlements.itemId })
    .from(entitlements)
    .where(and(eq(entitlements.merchantId, merchantId), eq(entitlements.issueMode, "stored_purchase"), gte(entitlements.createdAt, from), lt(entitlements.createdAt, to)));
  let storedPurchaseRevenue = 0;
  if (kept.length > 0) {
    const keptLines = await listLinesForVisits(db, [...new Set(kept.map((k) => k.originVisitId).filter((id): id is string => Boolean(id)))]);
    for (const k of kept) {
      const line = keptLines.find((l) => l.visitId === k.originVisitId && l.itemId === k.itemId && l.lineType === "regular");
      if (line) storedPurchaseRevenue += line.unitPriceCents;
    }
  }
  const [msg] = await db
    .select({ cost: sql<number>`coalesce(sum(${messages.estCostCents}), 0)::int` })
    .from(messages)
    .where(and(eq(messages.merchantId, merchantId), isNotNull(messages.sentAt), gte(messages.sentAt, from), lt(messages.sentAt, to)));
  return { ...summariseAttribution(rows, { storedPurchaseRevenueCents: storedPurchaseRevenue, messageCostCents: Number(msg?.cost ?? 0) }), visits: closed.length };
}

// ── Causal lift from the checkout holdout ──────────────────────────────────

export interface LiftReport {
  experimentExists: boolean;
  horizonDays: number;
  holdoutRate: number;
  assignedTreatment: number;
  assignedHoldout: number;
  matured: number;
  estimate: LiftEstimate | null;
}

/** Contribution per matured, identified customer over the horizon, treatment vs holdout. */
export async function liftOutcomes(db: Db, merchant: MerchantContext, now: Date): Promise<{ outcomes: AssignmentOutcome[]; all: { treatment: number; holdout: number } } | null> {
  const experiment = await getExperimentByKey(db, merchant.merchant.id, CHECKOUT_EXPERIMENT_KEY);
  if (!experiment) return null;
  const H = merchant.settings.experiment.horizonDays;
  const everything = await allAssignments(db, experiment.id);
  const all = { treatment: everything.filter((a) => a.arm === "treatment").length, holdout: everything.filter((a) => a.arm === "holdout").length };
  const matured = await maturedCustomerAssignments(db, experiment.id, new Date(now.getTime() - H * DAY_MS));
  const outcomes: AssignmentOutcome[] = [];
  for (const a of matured) {
    if (!a.customerId) continue;
    const start = new Date(a.assignedAt.getTime() - 60_000);
    const end = new Date(a.assignedAt.getTime() + H * DAY_MS);
    const vs = await db
      .select({ id: visits.id, openedAt: visits.openedAt })
      .from(visits)
      .where(and(eq(visits.customerId, a.customerId), eq(visits.status, "closed"), gte(visits.openedAt, start), lte(visits.openedAt, end)));
    const lines = await listLinesForVisits(db, vs.map((v) => v.id));
    const gp = computeTotals(lines).gpCents;
    const [msg] = await db
      .select({ cost: sql<number>`coalesce(sum(${messages.estCostCents}), 0)::int` })
      .from(messages)
      .where(and(eq(messages.customerId, a.customerId), isNotNull(messages.sentAt), gte(messages.sentAt, start), lte(messages.sentAt, end)));
    // Anchors sold in the window and still owed at the horizon are a cost not yet paid.
    const owed = (await listEntitlementsForCustomer(db, a.customerId, OPEN))
      .filter((e) => e.createdAt.getTime() >= start.getTime() && e.createdAt.getTime() <= end.getTime())
      .reduce((s, e) => s + remainingCostCents(e), 0);
    outcomes.push({
      arm: a.arm,
      contributionCents: gp - Number(msg?.cost ?? 0) - owed,
      returnVisits: vs.filter((v) => v.openedAt.getTime() > a.assignedAt.getTime() + 60_000).length,
    });
  }
  return { outcomes, all };
}

export async function liftReport(db: Db, merchant: MerchantContext, now: Date): Promise<LiftReport> {
  const res = await liftOutcomes(db, merchant, now);
  const base = { horizonDays: merchant.settings.experiment.horizonDays, holdoutRate: merchant.settings.experiment.holdoutRate };
  if (!res) return { ...base, experimentExists: false, assignedTreatment: 0, assignedHoldout: 0, matured: 0, estimate: null };
  return {
    ...base,
    experimentExists: true,
    assignedTreatment: res.all.treatment,
    assignedHoldout: res.all.holdout,
    matured: res.outcomes.length,
    estimate: estimateLift(res.outcomes, merchant.settings.dealEngine.minMeasuredSamplesPerArm),
  };
}

// ── Today ──────────────────────────────────────────────────────────────────

export interface CustomerRef {
  id: string;
  name: string;
  segment: Segment | null;
  returnBand: "high" | "medium" | "at_risk" | null;
  score: number | null;
}

function ref(c: { id: string; displayName: string | null; phoneE164: string | null; segment: Segment | null; returnBand: CustomerRef["returnBand"]; returnProbability: number | null }): CustomerRef {
  return {
    id: c.id,
    name: c.displayName ?? maskPhone(c.phoneE164),
    segment: c.segment,
    returnBand: c.returnBand,
    score: c.returnProbability === null ? null : Math.round(c.returnProbability * 100),
  };
}

export interface TodayOverview {
  likelyToReturn: (CustomerRef & { anchors: string[]; usualDay: boolean })[];
  withAnchors: { customers: number; anchors: number; liabilityRetailCents: number; liabilityCostCents: number };
  highValue: (CustomerRef & { anchors: string[]; avgSpendCents: number })[];
  expiringSoon: (CustomerRef & { label: string; expiresAt: Date })[];
  pendingClaims: number;
  messagesToday: { scheduled: number; sent: number };
  openBills: number;
}

export async function todayOverview(db: Db, merchant: MerchantContext, now: Date): Promise<TodayOverview> {
  const mid = merchant.merchant.id;
  const customers = await listAllCustomers(db, mid);
  const anchors = await listEntitlementsForCustomers(db, customers.map((c) => c.id), ["active"]);
  const byCustomer = new Map<string, typeof anchors>();
  for (const e of anchors) byCustomer.set(e.customerId!, [...(byCustomer.get(e.customerId!) ?? []), e]);
  const weekday = localParts(now, merchant.merchant.timezone).weekday;

  const likely = customers
    .filter((c) => c.returnBand === "high" || (byCustomer.has(c.id) && c.preferredWeekday === weekday))
    .map((c) => ({ ...ref(c), anchors: (byCustomer.get(c.id) ?? []).map(entitlementLabel), usualDay: c.preferredWeekday === weekday }))
    .sort((a, b) => Number(b.usualDay) - Number(a.usualDay) || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 12);
  const highValue = customers
    .filter((c) => c.segment === "high_value")
    .map((c) => ({ ...ref(c), anchors: (byCustomer.get(c.id) ?? []).map(entitlementLabel), avgSpendCents: c.visitCount ? Math.round(c.totalSpendCents / c.visitCount) : 0 }))
    .sort((a, b) => b.avgSpendCents - a.avgSpendCents)
    .slice(0, 8);
  const soon = now.getTime() + merchant.settings.messaging.expiryWarningDays * DAY_MS;
  const custMap = new Map(customers.map((c) => [c.id, c]));
  const expiringSoon = anchors
    .filter((e) => e.expiresAt && e.expiresAt.getTime() <= soon && e.expiresAt.getTime() > now.getTime() && custMap.has(e.customerId!))
    .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())
    .slice(0, 12)
    .map((e) => ({ ...ref(custMap.get(e.customerId!)!), label: entitlementLabel(e), expiresAt: e.expiresAt! }));
  const [pending] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(entitlements)
    .where(and(eq(entitlements.merchantId, mid), eq(entitlements.status, "pending_claim")));
  const dayStart = new Date(now.getTime() - 12 * 3_600_000);
  const dayEnd = new Date(now.getTime() + 12 * 3_600_000);
  const msgs = await db
    .select({ status: messages.status, n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.merchantId, mid), gte(messages.scheduledFor, dayStart), lt(messages.scheduledFor, dayEnd)))
    .groupBy(messages.status);
  const open = await listVisits(db, mid, { status: "open", limit: 200 });
  return {
    likelyToReturn: likely,
    withAnchors: {
      customers: byCustomer.size,
      anchors: anchors.length,
      liabilityRetailCents: await outstandingLiabilityCents(db, mid),
      liabilityCostCents: anchors.reduce((s, e) => s + remainingCostCents(e), 0),
    },
    highValue,
    expiringSoon,
    pendingClaims: Number(pending?.n ?? 0),
    messagesToday: {
      scheduled: msgs.filter((m) => m.status === "scheduled").reduce((s, m) => s + Number(m.n), 0),
      sent: msgs.filter((m) => ["sent", "delivered", "read"].includes(m.status)).reduce((s, m) => s + Number(m.n), 0),
    },
    openBills: open.length,
  };
}

// ── Revenue opportunities ─────────────────────────────────────────────────

export type OpportunityKind = "bottle_refill" | "food_upsell" | "beer_return" | "package_renewal";

export interface Opportunity {
  kind: OpportunityKind;
  title: string;
  why: string;
  customers: (CustomerRef & { label: string })[];
  /** Rough expected gross profit if a quarter of them act on it. */
  expectedGpCents: number;
}

const BEER_CATEGORIES = new Set(["beer", "bucket", "flight"]);

export async function revenueOpportunities(db: Db, merchant: MerchantContext, avgVisitGpCents: number): Promise<Opportunity[]> {
  const customers = await listAllCustomers(db, merchant.merchant.id);
  const custMap = new Map(customers.map((c) => [c.id, c]));
  const anchors = (await listEntitlementsForCustomers(db, customers.map((c) => c.id), ["active"])).filter((e) => custMap.has(e.customerId!));
  const low = merchant.settings.messaging.bottleLowPercent;
  const groups: Record<OpportunityKind, { title: string; why: string; list: typeof anchors; gpEach: number }> = {
    bottle_refill: { title: "Bottle refill", why: `Bottles at or below ${low + 15}% — have the next bottle ready.`, list: [], gpEach: 0 },
    food_upsell: { title: "Food upsell", why: "Food anchors waiting — every redemption visit is a chance to sell sides, drinks and desserts.", list: [], gpEach: 0 },
    beer_return: { title: "Beer return", why: "Pints waiting in lockers — pair the return with food.", list: [], gpEach: 0 },
    package_renewal: { title: "Package renewal", why: "One unit left on a package — invite them to renew.", list: [], gpEach: 0 },
  };
  for (const e of anchors) {
    if (e.unitType === "percent") {
      if (e.quantityRemaining <= low + 15) groups.bottle_refill.list.push(e);
    } else if (e.quantityRemaining === 1 && e.quantityInitial > 1) {
      groups.package_renewal.list.push(e);
    } else if (e.coveredCategory && BEER_CATEGORIES.has(e.coveredCategory)) {
      groups.beer_return.list.push(e);
    } else {
      groups.food_upsell.list.push(e);
    }
  }
  return (Object.keys(groups) as OpportunityKind[])
    .map((kind) => {
      const g = groups[kind];
      const gpEach = kind === "bottle_refill" ? Math.round((g.list[0]?.unitRetailCents ?? 0) - (g.list[0]?.unitCostCents ?? 0)) : avgVisitGpCents;
      return {
        kind,
        title: g.title,
        why: g.why,
        customers: g.list.slice(0, 20).map((e) => ({ ...ref(custMap.get(e.customerId!)!), label: entitlementLabel(e) })),
        expectedGpCents: Math.round(g.list.length * 0.25 * Math.max(0, gpEach)),
      };
    })
    .filter((o) => o.customers.length > 0);
}

// ── Customers ──────────────────────────────────────────────────────────────

export interface CustomerRow extends CustomerRef {
  phoneMasked: string;
  redeemCode: string;
  anchors: string[];
  lastVisitAt: Date | null;
  visitCount: number;
  avgSpendCents: number;
  avgPartySize: number;
  lifetimeSpendCents: number;
  lifetimeGpCents: number;
  nextAction: { key: string; label: string; detail: string };
}

export async function customerList(
  db: Db,
  merchant: MerchantContext,
  now: Date,
  options: { segment?: Segment | null; search?: string | null; limit?: number } = {},
): Promise<CustomerRow[]> {
  const rows = await listCustomerRows(db, merchant.merchant.id, { ...options, limit: options.limit ?? 200 });
  const anchors = await listEntitlementsForCustomers(db, rows.map((r) => r.id), OPEN);
  const lastOffers = rows.length
    ? await db
        .select({ customerId: offerExposures.customerId, at: sql<Date>`max(${offerExposures.shownAt})` })
        .from(offerExposures)
        .where(and(inArray(offerExposures.customerId, rows.map((r) => r.id)), sql`(${offerExposures.isDiscount} or ${offerExposures.promoCostCents} > 0)`))
        .groupBy(offerExposures.customerId)
    : [];
  const lastOfferMap = new Map(lastOffers.map((o) => [o.customerId, o.at ? new Date(o.at) : null]));
  return rows.map((c) => {
    const mine = anchors.filter((e) => e.customerId === c.id);
    return {
      ...ref(c),
      phoneMasked: maskPhone(c.phoneE164),
      redeemCode: formatCode(c.redeemCode),
      anchors: mine.map((e) => (e.status === "pending_claim" ? `${entitlementLabel(e)} (unclaimed)` : entitlementLabel(e))),
      lastVisitAt: c.lastVisitAt,
      visitCount: c.visitCount,
      avgSpendCents: c.visitCount ? Math.round(c.totalSpendCents / c.visitCount) : 0,
      avgPartySize: c.avgPartySize,
      lifetimeSpendCents: c.totalSpendCents,
      lifetimeGpCents: c.totalGpCents,
      nextAction: nextRecommendedAction({
        now,
        segment: c.segment,
        anchors: mine.map((e) => ({ label: entitlementLabel(e), status: e.status, expiresAt: e.expiresAt })),
        lastOfferAt: lastOfferMap.get(c.id) ?? null,
        offerCooldownDays: merchant.settings.guardrails.offerCooldownDays,
        expiryWarningDays: merchant.settings.messaging.expiryWarningDays,
      }),
    };
  });
}

export async function customerDetail(db: Db, merchant: MerchantContext, customerId: string, now: Date) {
  const c = await getCustomer(db, merchant.merchant.id, customerId);
  const ents = await listEntitlementsForCustomer(db, c.id);
  const ledger = await Promise.all(ents.map(async (e) => ({ entitlement: e, label: entitlementLabel(e), remainingRetailCents: remainingRetailCents(e), events: await listEvents(db, e.id) })));
  const visitRows = await listVisits(db, merchant.merchant.id, { customerId: c.id, limit: 50 });
  const lines = await listLinesForVisits(db, visitRows.map((v) => v.id));
  const visitsWithTotals = visitRows.map((v) => ({ visit: v, totals: computeTotals(lines.filter((l) => l.visitId === v.id)) }));
  const exposures = await db.select().from(offerExposures).where(eq(offerExposures.customerId, c.id)).orderBy(desc(offerExposures.shownAt)).limit(50);
  return {
    customer: c,
    phoneMasked: maskPhone(c.phoneE164),
    redeemCode: formatCode(c.redeemCode),
    anchors: ledger,
    visits: visitsWithTotals,
    messages: await listMessages(db, merchant.merchant.id, { customerId: c.id, limit: 50 }),
    exposures,
    consents: await listConsents(db, c.id),
    nextAction: nextRecommendedAction({
      now,
      segment: c.segment,
      anchors: ents.filter((e) => OPEN.includes(e.status)).map((e) => ({ label: entitlementLabel(e), status: e.status, expiresAt: e.expiresAt })),
      lastOfferAt: exposures.find((x) => x.isDiscount || x.promoCostCents > 0)?.shownAt ?? null,
      offerCooldownDays: merchant.settings.guardrails.offerCooldownDays,
      expiryWarningDays: merchant.settings.messaging.expiryWarningDays,
    }),
  };
}

// ── Offers ─────────────────────────────────────────────────────────────────

export interface OfferPerformanceRow {
  key: string;
  name: string;
  offerType: string;
  channel: string;
  isDiscount: boolean;
  shown: number;
  accepted: number;
  redeemed: number;
  acceptanceRate: number;
  /** Anchor upgrades: share of sold anchors used at least once. Promotions: share used. */
  redemptionRate: number;
  /** New cash on the visits where the offer was used or the anchor redeemed. */
  incrementalSpendCents: number;
  incrementalGpCents: number;
  revenueCents: number;
  promoCostCents: number;
  /** GP of that new cash + upgrade revenue − promo cost − anchor cost redeemed. */
  contributionCents: number;
}

export async function offerPerformance(db: Db, merchantId: string, from: Date, to: Date): Promise<OfferPerformanceRow[]> {
  const xs = await db
    .select()
    .from(offerExposures)
    .where(and(eq(offerExposures.merchantId, merchantId), gte(offerExposures.shownAt, from), lt(offerExposures.shownAt, to)));
  const defs = await db.select({ id: offerDefinitions.id, name: offerDefinitions.name }).from(offerDefinitions).where(eq(offerDefinitions.merchantId, merchantId));
  const defName = new Map(defs.map((d) => [d.id, d.name]));
  const groups = new Map<string, typeof xs>();
  for (const x of xs) {
    const key = x.offerType === "anchor_upgrade" ? `anchor_upgrade:${String((x.payload as { programId?: string }).programId ?? "")}` : `${x.offerDefinitionId ?? x.offerType}:${x.channel}`;
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  const rows: OfferPerformanceRow[] = [];
  for (const [key, list] of groups) {
    const first = list[0]!;
    const accepted = list.filter((x) => x.status === "accepted" || x.status === "redeemed");
    let redeemed = list.filter((x) => x.status === "redeemed").length;
    let incremental = 0;
    let incrementalGp = 0;
    let anchorCost = 0;
    let revenue = 0;
    if (first.offerType === "anchor_upgrade") {
      const entIds = accepted.map((x) => x.entitlementId).filter((id): id is string => Boolean(id));
      revenue = accepted.reduce((s, x) => s + x.valueCents, 0);
      if (entIds.length) {
        const redLines = await db
          .select({ visitId: visitLines.visitId, entitlementId: visitLines.entitlementId, cost: visitLines.unitCostCents, qty: visitLines.quantity })
          .from(visitLines)
          .where(and(inArray(visitLines.entitlementId, entIds), eq(visitLines.lineType, "anchor_redemption"), sql`${visitLines.voidedAt} is null`));
        redeemed = new Set(redLines.map((l) => l.entitlementId)).size;
        anchorCost = redLines.reduce((s, l) => s + l.cost * l.qty, 0);
        const visitIds = [...new Set(redLines.map((l) => l.visitId))];
        const t = computeTotals(await listLinesForVisits(db, visitIds));
        incremental = t.newCashRevenueCents;
        incrementalGp = t.newCashGpCents;
      }
    } else {
      const used = list.filter((x) => x.status === "redeemed" || (x.channel === "staff_upsell" && x.status === "accepted"));
      redeemed = used.length;
      const visitIds = [...new Set(used.map((x) => x.visitId).filter((id): id is string => Boolean(id)))];
      if (visitIds.length) {
        const t = computeTotals(await listLinesForVisits(db, visitIds));
        incremental = t.newCashRevenueCents;
        incrementalGp = t.newCashGpCents;
      }
    }
    const promo = list.filter((x) => x.status === "redeemed" || (x.channel === "staff_upsell" && x.status === "accepted")).reduce((s, x) => s + x.promoCostCents, 0);
    rows.push({
      key,
      name: first.offerType === "anchor_upgrade" ? String(((first.payload as { pitch?: { label?: string } }).pitch?.label) ?? "Return Anchor upgrade") : (first.offerDefinitionId ? defName.get(first.offerDefinitionId) : null) ?? first.offerType,
      offerType: first.offerType,
      channel: first.channel,
      isDiscount: first.isDiscount,
      shown: list.length,
      accepted: accepted.length,
      redeemed,
      acceptanceRate: list.length ? accepted.length / list.length : 0,
      redemptionRate: first.offerType === "anchor_upgrade" ? (accepted.length ? redeemed / accepted.length : 0) : list.length ? redeemed / list.length : 0,
      incrementalSpendCents: incremental,
      incrementalGpCents: incrementalGp,
      revenueCents: revenue,
      promoCostCents: promo,
      contributionCents: incrementalGp + revenue - promo - anchorCost,
    });
  }
  return rows.sort((a, b) => b.shown - a.shown);
}

// ── Campaigns ──────────────────────────────────────────────────────────────

export interface CampaignPerformance {
  campaign: Campaign;
  treatment: { n: number; returned: number; gpCents: number };
  holdout: { n: number; returned: number; gpCents: number };
  /** Return-rate difference (treatment − holdout). */
  returnLift: number;
  /** GP per recipient difference × treatment size − message cost. */
  estimatedIncrementalGpCents: number;
  messageCostCents: number;
  daysSinceLaunch: number;
}

export async function campaignPerformance(db: Db, merchantId: string, now: Date, horizonDays = 30): Promise<CampaignPerformance[]> {
  const list = await listCampaigns(db, merchantId);
  const result: CampaignPerformance[] = [];
  for (const campaign of list) {
    const recipients = await listRecipients(db, campaign.id);
    const start = campaign.scheduledFor ?? campaign.createdAt;
    const end = new Date(Math.min(now.getTime(), start.getTime() + horizonDays * DAY_MS));
    const arm = { treatment: { n: 0, returned: 0, gpCents: 0 }, holdout: { n: 0, returned: 0, gpCents: 0 } };
    for (const r of recipients) {
      const vs = await db
        .select({ id: visits.id })
        .from(visits)
        .where(and(eq(visits.customerId, r.customerId), eq(visits.status, "closed"), gte(visits.openedAt, start), lte(visits.openedAt, end)));
      const gp = vs.length ? computeTotals(await listLinesForVisits(db, vs.map((v) => v.id))).gpCents : 0;
      const a = arm[r.arm];
      a.n++;
      if (vs.length > 0) a.returned++;
      a.gpCents += gp;
    }
    const msgIds = recipients.map((r) => r.messageId).filter((id): id is string => Boolean(id));
    const [mc] = msgIds.length
      ? await db.select({ cost: sql<number>`coalesce(sum(${messages.estCostCents}), 0)::int` }).from(messages).where(and(inArray(messages.id, msgIds), isNotNull(messages.sentAt)))
      : [{ cost: 0 }];
    const tRate = arm.treatment.n ? arm.treatment.returned / arm.treatment.n : 0;
    const hRate = arm.holdout.n ? arm.holdout.returned / arm.holdout.n : 0;
    const tGp = arm.treatment.n ? arm.treatment.gpCents / arm.treatment.n : 0;
    const hGp = arm.holdout.n ? arm.holdout.gpCents / arm.holdout.n : 0;
    const messageCost = Number(mc?.cost ?? 0);
    result.push({
      campaign,
      treatment: arm.treatment,
      holdout: arm.holdout,
      returnLift: arm.holdout.n ? tRate - hRate : 0,
      estimatedIncrementalGpCents: arm.holdout.n ? Math.round((tGp - hGp) * arm.treatment.n - messageCost) : 0,
      messageCostCents: messageCost,
      daysSinceLaunch: Math.max(0, Math.floor(daysBetween(start, now))),
    });
  }
  return result;
}
