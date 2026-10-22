/**
 * The Meta webhook end to end (below the HTTP layer): a customer's STOP opts them out of
 * every message, Meta's retries are ignored, and delivery receipts update the outbox.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getCustomer, insertCustomer, recordConsent } from "@/modules/customers/repo";
import { CONSENT_NOTICE_VERSION } from "@/modules/customers/config";
import { listMessages } from "@/modules/messaging/repo";
import type { Db } from "@/server/db";
import { createMerchantFromPreset } from "@/flows/onboarding";
import { processMetaWebhook } from "@/flows/whatsapp-webhook";
import { at, createTestDb, MONDAY_EVENING } from "../helpers/db";

const delivery = (value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", ...value } }] }],
});

describe("WhatsApp webhook", () => {
  let db: Db;
  let close: () => Promise<void>;
  let merchantId: string;
  let customerId: string;

  before(async () => {
    ({ db, close } = await createTestDb());
    merchantId = (await createMerchantFromPreset(db, { name: "ABC Kitchen", vertical: "restaurant", now: MONDAY_EVENING })).id;
    customerId = (await insertCustomer(db, { merchantId, phoneE164: "+6582224444", at: MONDAY_EVENING })).id;
    for (const purpose of ["marketing_messages", "service_messages"] as const) {
      await recordConsent(db, { merchantId, customerId, purpose, granted: true, source: "whatsapp", noticeVersion: CONSENT_NOTICE_VERSION, at: MONDAY_EVENING });
    }
  });
  after(() => close());

  it("opts the customer out on STOP and ignores Meta's retry of the same message", async () => {
    const stop = delivery({ messages: [{ from: "6582224444", id: "wamid.stop", type: "text", text: { body: "STOP" } }] });
    const first = await processMetaWebhook(db, stop, at(MONDAY_EVENING, 60_000));
    assert.equal(first.messages, 1);
    const customer = await getCustomer(db, merchantId, customerId);
    assert.equal(customer.whatsappMarketingOptIn, false);
    assert.equal(customer.whatsappServiceOptIn, false);

    const retry = await processMetaWebhook(db, stop, at(MONDAY_EVENING, 120_000));
    assert.equal(retry.replies, 0);
    const inbound = (await listMessages(db, merchantId, { customerId })).filter((m) => m.direction === "inbound");
    assert.equal(inbound.length, 1);
  });

  it("applies delivery receipts to the matching outbound message", async () => {
    const sent = (await listMessages(db, merchantId, { customerId })).find((m) => m.direction === "outbound" && m.providerMessageId);
    assert.ok(sent, "the STOP acknowledgement was sent");
    const result = await processMetaWebhook(
      db,
      delivery({ statuses: [{ id: sent.providerMessageId, status: "failed", errors: [{ title: "Message undeliverable" }] }] }),
      at(MONDAY_EVENING, 180_000),
    );
    assert.equal(result.statuses, 1);
    const after = (await listMessages(db, merchantId, { customerId })).find((m) => m.id === sent.id)!;
    assert.equal(after.status, "failed");
    assert.equal(after.error, "Message undeliverable");
  });
});
