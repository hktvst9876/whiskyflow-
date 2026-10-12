import "server-only";
import { eq } from "drizzle-orm";
import { inTransaction, type Db } from "@/server/db";
import { logger } from "@/core/logger";
import { applyExpire } from "@/modules/anchors/ledger";
import { getEntitlement, listDueForExpiry, listEntitlements } from "@/modules/anchors/repo";
import { applyLedgerChange } from "@/modules/anchors/service";
import { entitlementLabel } from "@/modules/anchors/labels";
import { estimateLift, measuredUplift } from "@/modules/analytics/lift";
import { liftOutcomes } from "@/modules/analytics/queries";
import { getCustomer } from "@/modules/customers/repo";
import { gatherFraudFacts, saveFindings } from "@/modules/fraud/repo";
import { runFraudRules } from "@/modules/fraud/rules";
import { listMerchants, loadMerchantContext, type MerchantContext } from "@/modules/merchants/repo";
import { appState } from "@/modules/merchants/schema";
import { cancelScheduledForEntitlement } from "@/modules/messaging/repo";
import { nextSendSlot, winBackDue } from "@/modules/messaging/timing";
import { expireExposures } from "@/modules/offers/repo";
import { measuredUpliftKey } from "./checkout-offer";
import { systemActor } from "./context";
import { dispatchDueMessages, scheduleMessage, type DispatchOutcome } from "./messages";
import { rescoreStale } from "./scoring";

/**
 * MVP steps 10-11: "wait for the appropriate return timing, then remind". One idempotent
 * tick (cron every ~5 minutes, or the demo's time travel) that:
 *   1. expires anchors past their date and drops their pending messages,
 *   2. expires unused WhatsApp promotions,
 *   3. plans state-based nudges (win-back, bottle low, renewal) — once per anchor,
 *   4. sends every due message through the send-time policy,
 *   5. rescores stale customers,
 *   6. runs the fraud scan,
 *   7. refreshes the measured uplift the deal engine uses (twice a day).
 */

export interface TickSummary {
  expiredAnchors: number;
  expiredPromotions: number;
  nudgesPlanned: number;
  messages: { sent: number; suppressed: number; deferred: number; failed: number };
  rescored: number;
  fraudFlags: number;
}

const UPLIFT_REFRESH_MS = 12 * 3_600_000;

async function planNudges(db: Db, merchant: MerchantContext, now: Date): Promise<number> {
  const s = merchant.settings.messaging;
  const tz = merchant.merchant.timezone;
  const slot = nextSendSlot(now, s, tz);
  const active = (await listEntitlements(db, merchant.merchant.id, { statuses: ["active"], limit: 5000 })).filter((e) => e.customerId);
  let planned = 0;
  for (const e of active) {
    const customer = await getCustomer(db, merchant.merchant.id, e.customerId!);
    if (customer.status !== "active") continue;
    const label = entitlementLabel(e);
    let message = null;
    if (e.unitType === "percent" && e.quantityRemaining > 0 && e.quantityRemaining <= s.bottleLowPercent) {
      message = await scheduleMessage(db, {
        merchant,
        customer,
        templateKey: "bottle_low",
        variables: { item: e.displayName, level: String(e.quantityRemaining) },
        scheduledFor: slot,
        dedupeKey: `bottlelow:${e.id}`,
        entitlementId: e.id,
        at: now,
      });
    } else if (e.unitType !== "percent" && e.quantityInitial > 1 && e.quantityRemaining === 1) {
      message = await scheduleMessage(db, {
        merchant,
        customer,
        templateKey: "anchor_renewal",
        variables: { label, bonus_line: "" },
        scheduledFor: slot,
        dedupeKey: `renewal:${e.id}`,
        entitlementId: e.id,
        at: now,
      });
    }
    if (message) planned++;
    if (winBackDue(customer.lastVisitAt, e.createdAt, now, s)) {
      const winBack = await scheduleMessage(db, {
        merchant,
        customer,
        templateKey: "anchor_win_back",
        variables: { label, perk_line: "" },
        scheduledFor: slot,
        dedupeKey: `winback:${e.id}`,
        entitlementId: e.id,
        at: now,
      });
      if (winBack) planned++;
    }
  }
  return planned;
}

async function refreshMeasuredUplift(db: Db, merchant: MerchantContext, now: Date) {
  if (!merchant.settings.dealEngine.useMeasuredLift) return;
  const key = measuredUpliftKey(merchant.merchant.id);
  const stampKey = `${key}:at`;
  const [stamp] = await db.select().from(appState).where(eq(appState.key, stampKey));
  if (typeof stamp?.value === "number" && now.getTime() - stamp.value < UPLIFT_REFRESH_MS) return;
  const res = await liftOutcomes(db, merchant, now);
  const minPerArm = merchant.settings.dealEngine.minMeasuredSamplesPerArm;
  const value = res ? measuredUplift(estimateLift(res.outcomes, minPerArm), minPerArm) : null;
  const upsert = (k: string, v: number) =>
    db.insert(appState).values({ key: k, value: v, updatedAt: now }).onConflictDoUpdate({ target: appState.key, set: { value: v, updatedAt: now } });
  // No trustworthy measurement yet → no stored value, so the engine keeps its prior.
  if (value === null) await db.delete(appState).where(eq(appState.key, key));
  else await upsert(key, value);
  await upsert(stampKey, now.getTime());
}

export async function runSchedulerTick(db: Db, now: Date, options: { merchantIds?: string[] } = {}): Promise<TickSummary> {
  const summary: TickSummary = {
    expiredAnchors: 0,
    expiredPromotions: 0,
    nudgesPlanned: 0,
    messages: { sent: 0, suppressed: 0, deferred: 0, failed: 0 },
    rescored: 0,
    fraudFlags: 0,
  };

  for (const due of await listDueForExpiry(db, now)) {
    if (options.merchantIds && !options.merchantIds.includes(due.merchantId)) continue;
    await inTransaction(db, async (tx) => {
      const e = await getEntitlement(tx, due.merchantId, due.id, { forUpdate: true });
      if (e.status !== "active" && e.status !== "pending_claim") return;
      await applyLedgerChange(tx, e, applyExpire(e), { visitId: null, actor: systemActor, at: now });
      await cancelScheduledForEntitlement(tx, e.id, "Anchor expired", now);
      summary.expiredAnchors++;
    });
  }
  summary.expiredPromotions = await expireExposures(db, now);

  const merchants = (await listMerchants(db)).filter((m) => !options.merchantIds || options.merchantIds.includes(m.id));
  const contexts = await Promise.all(merchants.map((m) => loadMerchantContext(db, m.id)));
  for (const merchant of contexts) {
    if (merchant.settings.messaging.enabled) summary.nudgesPlanned += await planNudges(db, merchant, now);
  }

  const outcomes: DispatchOutcome[] = await dispatchDueMessages(db, now, 1000);
  for (const o of outcomes) {
    if (o.status === "sent" || o.status === "delivered") summary.messages.sent++;
    else summary.messages[o.status]++;
  }

  for (const merchant of contexts) {
    summary.rescored += await rescoreStale(db, merchant, now);
    const facts = await gatherFraudFacts(db, merchant.merchant.id, new Date(now.getTime() - 7 * 86_400_000), now);
    summary.fraudFlags += await saveFindings(db, merchant.merchant.id, runFraudRules(facts), now);
    try {
      await refreshMeasuredUplift(db, merchant, now);
    } catch (error) {
      logger.warn("Could not refresh measured uplift", { merchantId: merchant.merchant.id, error: String(error) });
    }
  }
  return summary;
}
