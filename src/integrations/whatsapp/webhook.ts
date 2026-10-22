import "server-only";
import { safeEqual } from "@/server/crypto";

/**
 * Meta WhatsApp Cloud API webhooks: the GET subscription handshake and the POST payload.
 * Parsing is defensive: Meta adds fields and message types over time, and anything we
 * don't understand is skipped rather than failing the whole delivery.
 */

export interface InboundWhatsAppText {
  fromPhone: string;
  text: string;
  providerMessageId: string;
}

export interface WhatsAppStatusReceipt {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  error: string | null;
}

/** GET handshake. Returns the challenge to echo back, or null to reject. */
export function verifySubscription(params: URLSearchParams, verifyToken: string | null): string | null {
  if (!verifyToken || params.get("hub.mode") !== "subscribe") return null;
  const challenge = params.get("hub.challenge");
  if (!challenge || !safeEqual(params.get("hub.verify_token") ?? "", verifyToken)) return null;
  return challenge;
}

const RECEIPT_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** The words a customer sent: typed text, a template quick-reply button, or an interactive reply. */
function messageText(m: Record<string, unknown>): string | null {
  switch (m.type) {
    case "text":
      return str(obj(m.text).body);
    case "button":
      return str(obj(m.button).text) ?? str(obj(m.button).payload);
    case "interactive": {
      const i = obj(m.interactive);
      return str(obj(i.button_reply).title) ?? str(obj(i.list_reply).title);
    }
    default:
      return null; // images, audio, stickers… carry no keyword
  }
}

function receiptError(s: Record<string, unknown>): string | null {
  const first = obj(arr(s.errors)[0]);
  return str(obj(first.error_data).details) ?? str(first.message) ?? str(first.title);
}

/** Flatten a webhook body into customer texts and delivery receipts. */
export function parseMetaWebhook(body: unknown): { messages: InboundWhatsAppText[]; statuses: WhatsAppStatusReceipt[] } {
  const messages: InboundWhatsAppText[] = [];
  const statuses: WhatsAppStatusReceipt[] = [];
  for (const entry of arr(obj(body).entry)) {
    for (const change of arr(obj(entry).changes)) {
      const value = obj(obj(change).value);
      for (const raw of arr(value.messages)) {
        const m = obj(raw);
        const from = str(m.from);
        const id = str(m.id);
        const text = messageText(m);
        if (from && id && text) messages.push({ fromPhone: from, text, providerMessageId: id });
      }
      for (const raw of arr(value.statuses)) {
        const s = obj(raw);
        const id = str(s.id);
        const status = str(s.status);
        if (id && status && RECEIPT_STATUSES.has(status)) {
          statuses.push({
            providerMessageId: id,
            status: status as WhatsAppStatusReceipt["status"],
            error: status === "failed" ? receiptError(s) : null,
          });
        }
      }
    }
  }
  return { messages, statuses };
}
