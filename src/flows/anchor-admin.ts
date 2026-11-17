import "server-only";
import { ValidationError } from "@/core/errors";
import { inTransaction, type Db } from "@/server/db";
import { applyAdjust, applyRefund, applyVoid, refundAllowed } from "@/modules/anchors/ledger";
import { getEntitlement, listEntitlementsForCustomer, type EntitlementRecord } from "@/modules/anchors/repo";
import { applyLedgerChange } from "@/modules/anchors/service";
import { writeAudit } from "@/modules/audit/service";
import { anonymiseCustomer, getCustomer } from "@/modules/customers/repo";
import { resolveFlag } from "@/modules/fraud/repo";
import { cancelScheduledForEntitlement } from "@/modules/messaging/repo";
import { assertSameMerchant, type FlowContext } from "./context";

/**
 * Manager corrections to what a customer owns. Every one needs a written reason, goes
 * through the ledger (so the wallet history shows it) and is audited. These exist so the
 * rules shown to customers — refunds, corrections — can actually be honoured.
 */

async function locked(tx: Db, ctx: FlowContext, entitlementId: string): Promise<EntitlementRecord> {
  const e = await getEntitlement(tx, ctx.merchantId, entitlementId, { forUpdate: true });
  assertSameMerchant(e, ctx);
  return e;
}

/** Add or remove units by hand (e.g. a redemption keyed in by mistake). */
export async function adjustAnchor(db: Db, ctx: FlowContext, entitlementId: string, delta: number, reason: string): Promise<EntitlementRecord> {
  return inTransaction(db, async (tx) => {
    const e = await locked(tx, ctx, entitlementId);
    return applyLedgerChange(tx, e, applyAdjust(e, delta, reason), { visitId: null, actor: ctx.actor, at: ctx.now });
  });
}

/** Cancel an open anchor without a refund (issued by mistake, fraud). */
export async function voidAnchor(db: Db, ctx: FlowContext, entitlementId: string, reason: string): Promise<EntitlementRecord> {
  return inTransaction(db, async (tx) => {
    const e = await locked(tx, ctx, entitlementId);
    const updated = await applyLedgerChange(tx, e, applyVoid(e, reason), { visitId: null, actor: ctx.actor, at: ctx.now });
    await cancelScheduledForEntitlement(tx, e.id, "Anchor voided", ctx.now);
    return updated;
  });
}

/**
 * Refund an anchor under the policy frozen in its terms. The money itself goes back
 * through the merchant's own till; this records it and closes the anchor.
 */
export async function refundAnchor(db: Db, ctx: FlowContext, entitlementId: string, reason: string): Promise<{ entitlement: EntitlementRecord; refundCents: number }> {
  return inTransaction(db, async (tx) => {
    const e = await locked(tx, ctx, entitlementId);
    const allowed = refundAllowed({ ...e, refundPolicy: e.termsSnapshot.refundPolicy }, ctx.now);
    if (!allowed.ok) throw new ValidationError(allowed.reason);
    const updated = await applyLedgerChange(tx, e, applyRefund(e, reason || "Refunded under the anchor's terms"), { visitId: null, actor: ctx.actor, at: ctx.now });
    await cancelScheduledForEntitlement(tx, e.id, "Anchor refunded", ctx.now);
    return { entitlement: updated, refundCents: e.pricePaidCents };
  });
}

/**
 * Privacy request: remove the customer's identity. Refused while they still own
 * something, because an anonymised wallet could no longer be shown or redeemed —
 * redeem, refund or void the open anchors first.
 */
export async function anonymiseCustomerRecord(db: Db, ctx: FlowContext, customerId: string): Promise<void> {
  const customer = await getCustomer(db, ctx.merchantId, customerId);
  const open = await listEntitlementsForCustomer(db, customer.id, ["active", "pending_claim"]);
  if (open.length > 0) throw new ValidationError("This customer still owns something here. Redeem, refund or void it before deleting their details.");
  await anonymiseCustomer(db, customer.id, ctx.now);
  await writeAudit(db, { merchantId: ctx.merchantId, actorType: ctx.actor.type, actorId: ctx.actor.id, action: "customer.anonymised", entityType: "customer", entityId: customer.id, at: ctx.now });
}

/** Close a fraud flag after a human looked at it. Flags never punish automatically. */
export async function resolveFraudFlag(db: Db, ctx: FlowContext, flagId: string, status: "dismissed" | "confirmed"): Promise<void> {
  if (!ctx.actor.id) throw new ValidationError("Sign in to resolve a flag.");
  await resolveFlag(db, ctx.merchantId, flagId, status, ctx.actor.id, ctx.now);
  await writeAudit(db, { merchantId: ctx.merchantId, actorType: ctx.actor.type, actorId: ctx.actor.id, action: `fraud_flag.${status}`, entityType: "fraud_flag", entityId: flagId, at: ctx.now });
}
