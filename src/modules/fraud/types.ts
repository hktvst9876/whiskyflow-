/** Fraud/anomaly detection types. */

export type FraudSeverity = "low" | "medium" | "high";
export type FraudStatus = "open" | "dismissed" | "confirmed";

/** Facts gathered by the scan and fed to the pure rules. */
export interface FraudFacts {
  now: Date;
  /** Redemptions in the scan window. */
  redemptions: {
    entitlementId: string;
    actorId: string | null;
    redeemedAt: Date;
    issuedAt: Date;
    issuedByUserId: string | null;
    customerId: string | null;
  }[];
  /** Claims in the scan window. */
  claims: { entitlementId: string; customerId: string; claimedAt: Date }[];
  /** Anchor upgrade lines voided after their entitlement was issued. */
  voidedUpgrades: { visitId: string; entitlementId: string | null; voidedAt: Date; actorId: string | null }[];
  /** Manual balance adjustments in the scan window. */
  adjustments: { entitlementId: string; actorId: string | null; quantityDelta: number; at: Date }[];
}

export interface FraudFinding {
  ruleKey: string;
  severity: FraudSeverity;
  entityType: "entitlement" | "user" | "customer" | "visit";
  entityId: string;
  detail: Record<string, unknown>;
}

export interface FraudRule {
  key: string;
  label: string;
  description: string;
  check(facts: FraudFacts): FraudFinding[];
}
