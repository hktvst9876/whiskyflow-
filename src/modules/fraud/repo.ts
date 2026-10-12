import "server-only";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/server/db";
import { entitlementEvents, entitlements } from "../anchors/schema";
import { visitLines } from "../visits/schema";
import { fraudFlags } from "./schema";
import type { FraudFacts, FraudFinding, FraudStatus } from "./types";

/** Gather the facts the pure rules need for one merchant since `since`. */
export async function gatherFraudFacts(db: Db, merchantId: string, since: Date, now: Date): Promise<FraudFacts> {
  const events = await db
    .select({
      entitlementId: entitlementEvents.entitlementId,
      type: entitlementEvents.type,
      actorId: entitlementEvents.actorId,
      quantityDelta: entitlementEvents.quantityDelta,
      at: entitlementEvents.createdAt,
      issuedAt: entitlements.createdAt,
      issuedByUserId: entitlements.issuedByUserId,
      customerId: entitlements.customerId,
    })
    .from(entitlementEvents)
    .innerJoin(entitlements, eq(entitlements.id, entitlementEvents.entitlementId))
    .where(
      and(
        eq(entitlementEvents.merchantId, merchantId),
        gte(entitlementEvents.createdAt, since),
        inArray(entitlementEvents.type, ["redeemed", "level_recorded", "claimed", "adjusted"]),
      ),
    );

  const voided = await db
    .select({ visitId: visitLines.visitId, entitlementId: visitLines.entitlementId, voidedAt: visitLines.voidedAt, status: entitlements.status })
    .from(visitLines)
    .innerJoin(entitlements, eq(entitlements.id, visitLines.entitlementId))
    .where(
      and(
        eq(visitLines.merchantId, merchantId),
        eq(visitLines.lineType, "anchor_upgrade"),
        isNotNull(visitLines.voidedAt),
        gte(visitLines.voidedAt, since),
        inArray(entitlements.status, ["pending_claim", "active", "fully_redeemed"]),
      ),
    );

  return {
    now,
    redemptions: events
      .filter((e) => e.type === "redeemed" || e.type === "level_recorded")
      .map((e) => ({ entitlementId: e.entitlementId, actorId: e.actorId, redeemedAt: e.at, issuedAt: e.issuedAt, issuedByUserId: e.issuedByUserId, customerId: e.customerId })),
    claims: events
      .filter((e) => e.type === "claimed" && e.customerId)
      .map((e) => ({ entitlementId: e.entitlementId, customerId: e.customerId!, claimedAt: e.at })),
    voidedUpgrades: voided.map((v) => ({ visitId: v.visitId, entitlementId: v.entitlementId, voidedAt: v.voidedAt!, actorId: null })),
    adjustments: events
      .filter((e) => e.type === "adjusted")
      .map((e) => ({ entitlementId: e.entitlementId, actorId: e.actorId, quantityDelta: e.quantityDelta, at: e.at })),
  };
}

/** Store findings, skipping ones already open for the same rule and entity. */
export async function saveFindings(db: Db, merchantId: string, findings: FraudFinding[], at: Date): Promise<number> {
  if (findings.length === 0) return 0;
  const open = await db
    .select({ ruleKey: fraudFlags.ruleKey, entityId: fraudFlags.entityId })
    .from(fraudFlags)
    .where(and(eq(fraudFlags.merchantId, merchantId), inArray(fraudFlags.status, ["open", "dismissed", "confirmed"])));
  const seen = new Set(open.map((o) => `${o.ruleKey}:${o.entityId}`));
  let created = 0;
  for (const f of findings) {
    const key = `${f.ruleKey}:${f.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await db.insert(fraudFlags).values({ merchantId, ruleKey: f.ruleKey, severity: f.severity, entityType: f.entityType, entityId: f.entityId, detail: f.detail, createdAt: at });
    created++;
  }
  return created;
}

export async function listFlags(db: Db, merchantId: string, status?: FraudStatus) {
  const where = status ? and(eq(fraudFlags.merchantId, merchantId), eq(fraudFlags.status, status)) : eq(fraudFlags.merchantId, merchantId);
  return db.select().from(fraudFlags).where(where).orderBy(desc(fraudFlags.createdAt)).limit(200);
}

export async function resolveFlag(db: Db, merchantId: string, id: string, status: Exclude<FraudStatus, "open">, userId: string, at: Date) {
  await db
    .update(fraudFlags)
    .set({ status, resolvedBy: userId, resolvedAt: at })
    .where(and(eq(fraudFlags.id, id), eq(fraudFlags.merchantId, merchantId)));
}
