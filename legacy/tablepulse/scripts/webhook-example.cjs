// Usage: node scripts/webhook-example.cjs <session-uuid> <menu-item-uuid>
const { createHmac, randomUUID } = require("node:crypto");
const secret = process.env.TABLEPULSE_WEBHOOK_SECRET;
if (!secret || secret.length < 32)
  throw new Error("Set TABLEPULSE_WEBHOOK_SECRET (32+ characters)");
const body = JSON.stringify({
  externalId: `pos-${randomUUID()}`,
  sessionId: process.argv[2],
  items: [{ menuItemId: process.argv[3], quantity: 2 }],
  discount: false,
});
const timestamp = String(Math.floor(Date.now() / 1000));
fetch(
  `${process.env.TABLEPULSE_URL ?? "http://localhost:3000"}/api/pos/events`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tablepulse-timestamp": timestamp,
      "x-tablepulse-signature": createHmac("sha256", secret)
        .update(`${timestamp}.${body}`)
        .digest("hex"),
    },
    body,
  },
).then(async (response) => console.log(response.status, await response.json()));
