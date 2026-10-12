// Local HTTP smoke test. Runs only against an explicitly enabled seeded demo.
const assert = require("node:assert/strict");
const { createHmac, randomUUID } = require("node:crypto");
const base = process.env.TABLEPULSE_TEST_URL ?? "http://127.0.0.1:3001";
async function request(path, body, headers = {}) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: base,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function main() {
  const initial = await request("/api/state");
  assert.equal(
    initial.body.mode,
    "demo",
    "Smoke test must never run against live data",
  );
  assert.equal((await request("/api/demo/reset", {})).status, 200);
  let state = (await request("/api/state")).body;
  const instance = state.instances.find((i) => i.status === "active"),
    session = state.sessions.find((s) => s.id === instance.sessionId),
    token = state.displayTokens[session.id];
  const screen = await request(
    `/api/display?token=${encodeURIComponent(token)}`,
  );
  assert.equal(screen.status, 200);
  assert.ok(screen.body.offer);
  assert.equal(screen.body.customers, undefined);
  assert.equal(screen.body.orders, undefined);
  assert.equal(screen.body.venue_users, undefined);
  assert.equal((await request("/api/display?token=forged")).status, 404);
  assert.equal(
    (
      await request("/api/commands", {
        action: "redeem",
        sessionId: session.id,
        code: instance.code,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/commands", {
        action: "redeem",
        sessionId: session.id,
        code: instance.code,
      })
    ).status,
    409,
  );
  assert.equal(
    (await request("/api/commands", { action: "close", sessionId: session.id }))
      .status,
    200,
  );
  assert.equal(
    (await request(`/api/display?token=${encodeURIComponent(token)}`)).status,
    410,
  );
  const fresh = state.sessions.find(
    (s) => !s.closedAt && !s.offerReceived && !s.control,
  );
  const event = {
    externalId: `smoke-${randomUUID()}`,
    sessionId: fresh.id,
    customerRef: "smoke-loyalty-42",
    items: [{ menuItemId: state.menu[0].id, quantity: 2 }],
    discount: false,
  };
  const sent = await request("/api/commands", { action: "order", event });
  assert.equal(sent.status, 200);
  assert.ok(sent.body.decision);
  assert.equal(
    (await request("/api/commands", { action: "order", event })).body.duplicate,
    true,
  );
  assert.equal(
    (
      await request("/api/commands", {
        action: "order",
        event: { ...event, items: [{ ...event.items[0], quantity: 3 }] },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/api/commands", {
        action: "stock",
        menuItemId: state.menu[0].id,
        stock: -1,
        cost: 1,
        promotionEligible: true,
      })
    ).status,
    400,
  );
  const denied = await request(
    "/api/commands",
    { action: "settings", settings: state.settings },
    { Cookie: "tablepulse-demo-role=staff" },
  );
  assert.equal(denied.status, 403);
  const staff = (
    await request("/api/state", undefined, {
      Cookie: "tablepulse-demo-role=staff",
    })
  ).body;
  assert.deepEqual(staff.customers, []);
  assert.deepEqual(staff.history, []);
  const timestamp = String(Math.floor(Date.now() / 1000)),
    webhookSecret =
      "tablepulse-local-demo-TABLEPULSE_WEBHOOK_SECRET-not-for-production";
  const headers = {
    "x-tablepulse-timestamp": timestamp,
    "x-tablepulse-signature": createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${JSON.stringify(event)}`)
      .digest("hex"),
  };
  assert.equal((await request("/api/pos/events", event)).status, 401);
  assert.equal(
    (await request("/api/pos/events", event, headers)).body.duplicate,
    true,
  );
  const summary = await request("/api/integrations/summary", undefined, {
    "x-tablepulse-timestamp": timestamp,
    "x-tablepulse-signature": createHmac("sha256", webhookSecret)
      .update(`${timestamp}.`)
      .digest("hex"),
  });
  assert.equal(summary.status, 200);
  assert.ok(Array.isArray(summary.body.suspicious));
  assert.equal(
    (
      await request("/api/enrol", {
        token: state.displayTokens[state.sessions[1].id],
        consent: false,
        preferences: [],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/enrol", {
        token: state.displayTokens[state.sessions[1].id],
        consent: true,
        preferences: ["food"],
      })
    ).status,
    200,
  );
  await request("/api/demo/reset", {});
  console.log(
    "HTTP smoke checks passed: public data, forgery, redemption, revocation, order idempotency, validation, roles, webhooks, summary and consent. Demo restored.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
