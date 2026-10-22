import "server-only";
import { parseMetaWebhook } from "@/integrations/whatsapp/webhook";
import type { Db } from "@/server/db";
import { handleInboundText, handleStatusUpdate } from "./inbound-message";

/**
 * Apply one Meta webhook delivery: customer texts first (so a STOP lands before anything
 * else), then delivery receipts. Both handlers are idempotent on the provider message id,
 * so Meta's retries of the same delivery are safe.
 */
export async function processMetaWebhook(
  db: Db,
  body: unknown,
  now: Date,
): Promise<{ messages: number; replies: number; statuses: number }> {
  const parsed = parseMetaWebhook(body);
  let replies = 0;
  for (const message of parsed.messages) {
    replies += (await handleInboundText(db, { ...message, now })).replies;
  }
  let statuses = 0;
  for (const receipt of parsed.statuses) {
    if (await handleStatusUpdate(db, { ...receipt, now })) statuses++;
  }
  return { messages: parsed.messages.length, replies, statuses };
}
