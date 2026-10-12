/**
 * Anomaly rules (pure). Flags are for human review, never automatic punishment.
 * Thresholds are deliberately conservative to keep false positives low.
 */
import type { FraudFinding, FraudRule } from "./types";

export const FRAUD_THRESHOLDS = {
  // A redemption this soon after issue by the same staff member looks like self-dealing.
  rapidRedemptionMinutes: 30,
  // Redemptions one staff member processes in a day before we take a look.
  staffDailyRedemptions: 25,
  // Anchors one customer claims within 7 days.
  claimsPer7Days: 5,
} as const;

const DAY = 86_400_000;

export const rapidRedemption: FraudRule = {
  key: "rapid-redemption",
  label: "Redeemed right after issue",
  description: "The same staff member issued and redeemed an anchor within minutes.",
  check(f) {
    return f.redemptions
      .filter(
        (r) =>
          r.actorId &&
          r.actorId === r.issuedByUserId &&
          r.redeemedAt.getTime() - r.issuedAt.getTime() < FRAUD_THRESHOLDS.rapidRedemptionMinutes * 60_000,
      )
      .map<FraudFinding>((r) => ({
        ruleKey: "rapid-redemption",
        severity: "high",
        entityType: "entitlement",
        entityId: r.entitlementId,
        detail: { staffId: r.actorId, minutes: Math.round((r.redeemedAt.getTime() - r.issuedAt.getTime()) / 60_000) },
      }));
  },
};

export const staffRedemptionVolume: FraudRule = {
  key: "staff-redemption-volume",
  label: "Unusual redemption volume",
  description: "One staff member processed an unusually high number of redemptions in a day.",
  check(f) {
    const counts = new Map<string, number>();
    for (const r of f.redemptions) {
      if (!r.actorId || f.now.getTime() - r.redeemedAt.getTime() > DAY) continue;
      counts.set(r.actorId, (counts.get(r.actorId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, n]) => n > FRAUD_THRESHOLDS.staffDailyRedemptions)
      .map(([actorId, n]) => ({ ruleKey: "staff-redemption-volume", severity: "medium" as const, entityType: "user" as const, entityId: actorId, detail: { redemptions24h: n } }));
  },
};

export const manyClaims: FraudRule = {
  key: "many-claims",
  label: "Many anchors claimed by one customer",
  description: "One customer claimed an unusual number of anchors in a week (shared phone or abuse).",
  check(f) {
    const counts = new Map<string, number>();
    for (const c of f.claims) {
      if (f.now.getTime() - c.claimedAt.getTime() > 7 * DAY) continue;
      counts.set(c.customerId, (counts.get(c.customerId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, n]) => n > FRAUD_THRESHOLDS.claimsPer7Days)
      .map(([customerId, n]) => ({ ruleKey: "many-claims", severity: "medium" as const, entityType: "customer" as const, entityId: customerId, detail: { claims7d: n } }));
  },
};

export const voidedUpgrade: FraudRule = {
  key: "voided-upgrade",
  label: "Upgrade voided after the anchor was issued",
  description: "The paid upgrade line was voided but the anchor still exists — a free anchor.",
  check(f) {
    return f.voidedUpgrades.map((v) => ({
      ruleKey: "voided-upgrade",
      severity: "high" as const,
      entityType: "visit" as const,
      entityId: v.visitId,
      detail: { entitlementId: v.entitlementId, staffId: v.actorId },
    }));
  },
};

export const positiveAdjustment: FraudRule = {
  key: "positive-adjustment",
  label: "Balance increased manually",
  description: "Someone added units back to an anchor by hand.",
  check(f) {
    return f.adjustments
      .filter((a) => a.quantityDelta > 0)
      .map((a) => ({ ruleKey: "positive-adjustment", severity: "low" as const, entityType: "entitlement" as const, entityId: a.entitlementId, detail: { delta: a.quantityDelta, staffId: a.actorId } }));
  },
};

export const FRAUD_RULES: FraudRule[] = [rapidRedemption, staffRedemptionVolume, manyClaims, voidedUpgrade, positiveAdjustment];

export function runFraudRules(facts: Parameters<FraudRule["check"]>[0], rules = FRAUD_RULES): FraudFinding[] {
  return rules.flatMap((r) => r.check(facts));
}
