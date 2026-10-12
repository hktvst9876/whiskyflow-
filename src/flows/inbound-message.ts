import "server-only";
import { and, eq } from "drizzle-orm";
import { isE164 } from "@/core/phone";
import type { Db } from "@/server/db";
import { entitlementLabel } from "@/modules/anchors/labels";
import { listEntitlementsForCustomer } from "@/modules/anchors/repo";
import { CONSENT_NOTICE_VERSION } from "@/modules/customers/config";
import { recordConsent, toCustomer } from "@/modules/customers/repo";
import { customers } from "@/modules/customers/schema";
import { loadMerchantContext } from "@/modules/merchants/repo";
import { findMessageByProviderId, insertMessage, updateMessage } from "@/modules/messaging/repo";
import type { MessageStatus } from "@/modules/messaging/types";
import { scheduleMessage, sendMessageNow } from "./messages";

/**
 * Inbound WhatsApp: keywords and delivery statuses. STOP always wins and is acknowledged
 * with a reminder that the customer's balance is safe — opting out of messages never
 * costs anyone what they own.
 */

const STOP = /^\s*(stop|unsubscribe|opt ?out|cancel)\b/i;
const START = /^\s*(start|subscribe|opt ?in|unstop)\b/i;

export type InboundIntent = "opt_out" | "opt_in" | "balance";

export function inboundIntent(text: string): InboundIntent {
  if (STOP.test(text)) return "opt_out";
  if (START.test(text)) return "opt_in";
  return "balance";
}

/**
 * Handle a text from a customer. `merchantId` scopes it when the number belongs to one
 * merchant (demo inbox, per-merchant WhatsApp numbers); otherwise every merchant where
 * this phone is a customer replies.
 */
export async function handleInboundText(
  db: Db,
  input: { fromPhone: string; text: string; providerMessageId: string; now: Date; merchantId?: string | null },
): Promise<{ intent: InboundIntent; replies: number }> {
  const phone = input.fromPhone.startsWith("+") ? input.fromPhone : `+${input.fromPhone.replace(/\D/g, "")}`;
  const intent = inboundIntent(input.text);
  if (!isE164(phone)) return { intent, replies: 0 };
  const where = input.merchantId
    ? and(eq(customers.phoneE164, phone), eq(customers.merchantId, input.merchantId), eq(customers.status, "active"))
    : and(eq(customers.phoneE164, phone), eq(customers.status, "active"));
  const rows = await db.select().from(customers).where(where);
  let replies = 0;
  for (const row of rows) {
    const customer = toCustomer(row);
    const merchant = await loadMerchantContext(db, customer.merchantId);
    const inserted = await insertMessage(db, {
      merchantId: customer.merchantId,
      customerId: customer.id,
      direction: "inbound",
      templateKey: null,
      category: "service_reply",
      toPhone: phone,
      body: input.text.slice(0, 2000),
      status: "received",
      scheduledFor: input.now,
      dedupeKey: `in:${input.providerMessageId}`,
      providerMessageId: input.providerMessageId,
      at: input.now,
    });
    if (!inserted) continue; // duplicate webhook delivery
    const consent = { merchantId: customer.merchantId, customerId: customer.id, source: "whatsapp" as const, noticeVersion: CONSENT_NOTICE_VERSION, at: input.now };
    let reply;
    if (intent === "opt_out") {
      await recordConsent(db, { ...consent, purpose: "marketing_messages", granted: false });
      await recordConsent(db, { ...consent, purpose: "service_messages", granted: false });
      reply = await scheduleMessage(db, { merchant, customer, templateKey: "opt_out_ack", variables: {}, scheduledFor: input.now, dedupeKey: `reply:${input.providerMessageId}`, at: input.now });
    } else if (intent === "opt_in") {
      await recordConsent(db, { ...consent, purpose: "marketing_messages", granted: true });
      await recordConsent(db, { ...consent, purpose: "service_messages", granted: true });
      reply = await scheduleMessage(db, { merchant, customer, templateKey: "opt_in_ack", variables: {}, scheduledFor: input.now, dedupeKey: `reply:${input.providerMessageId}`, at: input.now });
    } else {
      const open = await listEntitlementsForCustomer(db, customer.id, ["active", "pending_claim"]);
      const balances = open.length > 0 ? open.map((e) => `• ${entitlementLabel(e)}`).join("\n") : "Nothing waiting right now — see you soon!";
      reply = await scheduleMessage(db, { merchant, customer, templateKey: "balance_reply", variables: { balances }, scheduledFor: input.now, dedupeKey: `reply:${input.providerMessageId}`, at: input.now });
    }
    if (reply) {
      await sendMessageNow(db, reply.id, input.now);
      replies++;
    }
  }
  return { intent, replies };
}

const STATUS_RANK: Partial<Record<MessageStatus, number>> = { sending: 0, sent: 1, delivered: 2, read: 3 };

/** Provider delivery receipts. Statuses only move forward; failures are recorded. */
export async function handleStatusUpdate(
  db: Db,
  input: { providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; error?: string | null; now: Date },
): Promise<boolean> {
  const message = await findMessageByProviderId(db, input.providerMessageId);
  if (!message) return false;
  if (input.status === "failed") {
    await updateMessage(db, message.id, { status: "failed", error: input.error ?? "Delivery failed", at: input.now });
    return true;
  }
  if ((STATUS_RANK[input.status] ?? 0) > (STATUS_RANK[message.status] ?? -1)) {
    await updateMessage(db, message.id, { status: input.status, at: input.now });
  }
  return true;
}
