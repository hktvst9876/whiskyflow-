import "server-only";
import { ValidationError, RateLimitError } from "@/core/errors";
import { normalisePhone } from "@/core/phone";
import { sha256 } from "@/server/crypto";
import { inTransaction, type Db } from "@/server/db";
import { entitlementHeadline, entitlementLabel } from "@/modules/anchors/labels";
import { findEntitlementByClaimHash, getEntitlement, type EntitlementRecord } from "@/modules/anchors/repo";
import { claimEntitlementRow, type Actor } from "@/modules/anchors/service";
import { transparencyLines } from "@/modules/anchors/terms";
import { consumeRateLimit } from "@/modules/auth/repo";
import { CONSENT_NOTICE_VERSION } from "@/modules/customers/config";
import {
  findCustomerByPhone,
  insertCustomer,
  recordConsent,
  updateCustomerName,
  walletTokenFor,
  type CustomerWithPromo,
} from "@/modules/customers/repo";
import type { ConsentSource } from "@/modules/customers/types";
import { loadMerchantContext, type MerchantContext } from "@/modules/merchants/repo";
import { exposuresForVisit, updateExposure } from "@/modules/offers/repo";
import { getVisit, updateVisit } from "@/modules/visits/repo";
import { assertSameMerchant, merchantFor, walletUrl, type FlowContext } from "./context";
import { planAnchorMessages, sendMessageNow } from "./messages";
import { refreshCustomer } from "./scoring";

/**
 * MVP steps 7-9: the customer scans the QR (or staff claim it for them by phone), the
 * anchor becomes theirs, they get a wallet link and a WhatsApp confirmation
 * "You have 1 Main Waiting". Consent is captured here, per purpose, with the notice
 * version, and the customer always sees exactly what they own before claiming.
 */

export interface ClaimView {
  entitlementId: string;
  merchant: { name: string; brandColor: string; currency: string; locale: string; timezone: string };
  label: string;
  headline: { primary: string; secondary: string };
  storageLocation: string | null;
  terms: { label: string; value: string }[];
  claimExpiresAt: Date | null;
  expired: boolean;
}

/** Public claim page data. Null when the link is unknown or already used. */
export async function getClaimView(db: Db, token: string, now: Date): Promise<ClaimView | null> {
  const e = await findEntitlementByClaimHash(db, sha256(token));
  if (!e || e.status !== "pending_claim") return null;
  const merchant = await loadMerchantContext(db, e.merchantId);
  const m = merchant.merchant;
  return {
    entitlementId: e.id,
    merchant: { name: m.name, brandColor: m.brandColor, currency: m.currency, locale: m.locale, timezone: m.timezone },
    label: entitlementLabel(e),
    headline: entitlementHeadline(e),
    storageLocation: e.storageLocation,
    terms: transparencyLines(e.termsSnapshot, { locale: m.locale, timeZone: m.timezone }),
    claimExpiresAt: e.claimExpiresAt,
    expired: Boolean(e.claimExpiresAt && e.claimExpiresAt.getTime() < now.getTime()),
  };
}

export interface ClaimInput {
  phone: string;
  name?: string | null;
  /** "Message me about what I own (confirmation, balance, expiry)". */
  serviceOptIn: boolean;
  /** "Send me occasional reminders and offers". Unticked by default. */
  marketingOptIn: boolean;
}

export interface ClaimResult {
  customerId: string;
  entitlementId: string;
  walletToken: string;
  walletUrl: string;
}

async function claimLocked(
  tx: Db,
  merchant: MerchantContext,
  entitlement: EntitlementRecord,
  input: ClaimInput & { source: ConsentSource; actor: Actor; now: Date },
): Promise<{ customer: CustomerWithPromo; entitlement: EntitlementRecord; originVisitClosed: boolean }> {
  const phone = normalisePhone(input.phone, merchant.merchant.country);
  if (!phone) throw new ValidationError("Enter a valid mobile number.", { phone: "Enter a valid mobile number." });
  let customer = await findCustomerByPhone(tx, merchant.merchant.id, phone);
  if (!customer) {
    customer = await insertCustomer(tx, { merchantId: merchant.merchant.id, phoneE164: phone, displayName: input.name?.trim() || null, at: input.now });
  } else if (input.name?.trim() && !customer.displayName) {
    await updateCustomerName(tx, customer.id, input.name.trim(), input.now);
  }
  const consent = { merchantId: merchant.merchant.id, customerId: customer.id, source: input.source, noticeVersion: CONSENT_NOTICE_VERSION, at: input.now };
  await recordConsent(tx, { ...consent, purpose: "terms", granted: true });
  await recordConsent(tx, { ...consent, purpose: "service_messages", granted: input.serviceOptIn });
  // Never silently revoke an earlier marketing opt-in because a box was left unticked.
  if (input.marketingOptIn || !customer.whatsappMarketingOptIn) {
    await recordConsent(tx, { ...consent, purpose: "marketing_messages", granted: input.marketingOptIn });
  }
  const claimed = await claimEntitlementRow(tx, entitlement, customer.id, {
    actor: input.actor.type === "customer" ? { type: "customer", id: customer.id } : input.actor,
    at: input.now,
    via: input.source === "claim_page" ? "claim_page" : "staff",
  });

  // Attribute the origin visit and its offer to the now-known customer.
  let originVisitClosed = false;
  if (entitlement.originVisitId) {
    const visit = await getVisit(tx, merchant.merchant.id, entitlement.originVisitId);
    if (!visit.customerId) await updateVisit(tx, visit.id, { customerId: customer.id });
    originVisitClosed = visit.status === "closed";
    for (const exposure of await exposuresForVisit(tx, visit.id)) {
      if (!exposure.customerId) await updateExposure(tx, exposure.id, { customerId: customer.id });
    }
  }
  return { customer, entitlement: claimed, originVisitClosed };
}

async function afterClaim(
  db: Db,
  merchant: MerchantContext,
  claimed: { customer: CustomerWithPromo; entitlement: EntitlementRecord; originVisitClosed: boolean },
  now: Date,
): Promise<ClaimResult> {
  let customer = claimed.customer;
  if (claimed.originVisitClosed) customer = (await refreshCustomer(db, merchant, customer.id, now)).customer;
  const token = await walletTokenFor(db, merchant.merchant.id, customer.id, now);
  const { confirmation } = await planAnchorMessages(db, merchant, claimed.entitlement, customer, now);
  if (confirmation) await sendMessageNow(db, confirmation.id, now);
  return { customerId: customer.id, entitlementId: claimed.entitlement.id, walletToken: token, walletUrl: walletUrl(token) };
}

/** Customer scanned the QR and entered their number. Rate-limited per client. */
export async function claimByToken(db: Db, token: string, input: ClaimInput & { clientKey: string; now: Date }): Promise<ClaimResult> {
  const allowed = await consumeRateLimit(db, `claim:${input.clientKey}`, 20, 900, input.now);
  if (!allowed) throw new RateLimitError();
  const claimed = await inTransaction(db, async (tx) => {
    const e = await findEntitlementByClaimHash(tx, sha256(token), { forUpdate: true });
    if (!e || e.status !== "pending_claim") throw new ValidationError("This link has already been used or is no longer valid.");
    if (e.claimExpiresAt && e.claimExpiresAt.getTime() < input.now.getTime()) {
      throw new ValidationError("This claim link has expired. Ask the staff to show the QR again.");
    }
    const merchant = await loadMerchantContext(tx, e.merchantId);
    return { merchant, ...(await claimLocked(tx, merchant, e, { ...input, source: "claim_page", actor: { type: "customer", id: null }, now: input.now })) };
  });
  return afterClaim(db, claimed.merchant, claimed, input.now);
}

/** Staff claim on the customer's behalf (customer gives their number at the counter). */
export async function claimByStaff(db: Db, ctx: FlowContext, entitlementId: string, input: ClaimInput): Promise<ClaimResult> {
  const merchant = await merchantFor(db, ctx);
  const claimed = await inTransaction(db, async (tx) => {
    const e = await getEntitlement(tx, ctx.merchantId, entitlementId, { forUpdate: true });
    assertSameMerchant(e, ctx);
    if (e.status !== "pending_claim") throw new ValidationError("This anchor has already been claimed.");
    return claimLocked(tx, merchant, e, { ...input, source: "staff", actor: ctx.actor, now: ctx.now });
  });
  return afterClaim(db, merchant, claimed, ctx.now);
}
