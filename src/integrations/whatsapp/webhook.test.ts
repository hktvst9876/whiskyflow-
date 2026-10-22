import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hmacHex } from "@/server/crypto";
import { verifyMetaSignature } from "./signature";
import { parseMetaWebhook, verifySubscription } from "./webhook";

const delivery = (value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", ...value } }] }],
});

describe("Meta webhook parsing", () => {
  it("reads typed text, template quick-reply buttons and interactive replies", () => {
    const { messages } = parseMetaWebhook(
      delivery({
        messages: [
          { from: "6582223333", id: "wamid.1", type: "text", text: { body: "STOP" } },
          { from: "6582223333", id: "wamid.2", type: "button", button: { text: "Stop promotions", payload: "STOP" } },
          { from: "6582223333", id: "wamid.3", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "b", title: "Balance" } } },
          { from: "6582223333", id: "wamid.4", type: "image", image: { id: "media" } },
        ],
      }),
    );
    assert.deepEqual(
      messages.map((m) => [m.providerMessageId, m.text]),
      [
        ["wamid.1", "STOP"],
        ["wamid.2", "Stop promotions"],
        ["wamid.3", "Balance"],
      ],
    );
    assert.equal(messages[0]!.fromPhone, "6582223333");
  });

  it("keeps known delivery receipts and the failure reason", () => {
    const { statuses } = parseMetaWebhook(
      delivery({
        statuses: [
          { id: "wamid.9", status: "read", recipient_id: "6582223333" },
          { id: "wamid.8", status: "failed", errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Not on WhatsApp" } }] },
          { id: "wamid.7", status: "deleted" },
        ],
      }),
    );
    assert.deepEqual(statuses, [
      { providerMessageId: "wamid.9", status: "read", error: null },
      { providerMessageId: "wamid.8", status: "failed", error: "Not on WhatsApp" },
    ]);
  });

  it("ignores malformed bodies instead of throwing", () => {
    for (const body of [null, "x", 42, {}, { entry: "nope" }, { entry: [{ changes: [{ value: { messages: [{ type: "text" }] } }] }] }]) {
      assert.deepEqual(parseMetaWebhook(body), { messages: [], statuses: [] });
    }
  });
});

describe("Meta webhook verification", () => {
  const params = (q: Record<string, string>) => new URLSearchParams(q);

  it("echoes the challenge only for the configured verify token", () => {
    const ok = params({ "hub.mode": "subscribe", "hub.verify_token": "secret-token", "hub.challenge": "123" });
    assert.equal(verifySubscription(ok, "secret-token"), "123");
    assert.equal(verifySubscription(ok, "other-token"), null);
    assert.equal(verifySubscription(ok, null), null);
    assert.equal(verifySubscription(params({ "hub.mode": "unsubscribe", "hub.verify_token": "secret-token", "hub.challenge": "1" }), "secret-token"), null);
  });

  it("accepts only bodies signed with the app secret", () => {
    const body = JSON.stringify(delivery({ messages: [] }));
    const header = `sha256=${hmacHex("app-secret", body)}`;
    assert.equal(verifyMetaSignature(body, header, "app-secret"), true);
    assert.equal(verifyMetaSignature(body, header, "wrong-secret"), false);
    assert.equal(verifyMetaSignature(`${body} `, header, "app-secret"), false);
    assert.equal(verifyMetaSignature(body, null, "app-secret"), false);
  });
});
