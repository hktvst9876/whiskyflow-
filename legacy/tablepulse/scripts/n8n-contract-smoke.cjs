// Tests the exported request contract against TablePulse, NOT a real n8n runtime.
// Creates/closes one disposable demo visit; preserves existing demo memberships.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createHmac, randomUUID } = require("node:crypto");
const base = process.env.TABLEPULSE_TEST_URL ?? "http://127.0.0.1:3001";
const workflow = JSON.parse(
  fs.readFileSync("integrations/n8n/tablepulse-pos-decision.json", "utf8"),
);
const node = (name) => workflow.nodes.find((n) => n.name === name);
function code(name, json, externalId) {
  const result = vm.runInNewContext(
    `(function(){${node(name).parameters.jsCode}\n})()`,
    {
      $input: { first: () => ({ json }) },
      $: () => ({ first: () => ({ json: { externalId } }) }),
    },
    { timeout: 1000 },
  );
  return JSON.parse(JSON.stringify(result))[0].json;
}
function expression(value, json) {
  const match = value.match(/^=\{\{([\s\S]*)\}\}$/);
  assert.ok(match, "Expected an n8n expression");
  return vm.runInNewContext(match[1], { $json: json }, { timeout: 1000 });
}
async function request(path, body, headers = {}) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: {
      Origin: base,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
  return { statusCode: response.status, body: await response.json() };
}
async function main() {
  const initial = await request("/api/state");
  assert.equal(initial.body.mode, "demo", "Never run against live venue data");
  const table = initial.body.tables.find(
    (t) =>
      !initial.body.sessions.some((s) => s.tableId === t.id && !s.closedAt),
  );
  assert.ok(table, "A spare demo table is needed");
  assert.equal(
    (await request("/api/commands", { action: "session", tableId: table.id }))
      .statusCode,
    200,
  );
  const state = (await request("/api/state")).body;
  const session = state.sessions.find(
    (s) => s.tableId === table.id && !s.closedAt,
  );
  try {
    const mainItem = state.menu.find((m) => m.main && m.stock >= 3);
    assert.ok(mainItem);
    const event = {
      externalId: `n8n-contract-${randomUUID()}`,
      sessionId: session.id,
      items: [{ menuItemId: mainItem.id, quantity: 2 }],
      discount: false,
    };
    const prepared = code("Validate order", { body: event });
    assert.equal(prepared.valid, true);
    const signedValue = expression(
      node("Sign TablePulse request").parameters.value,
      prepared,
    );
    const secret =
      process.env.TABLEPULSE_WEBHOOK_SECRET ??
      "tablepulse-local-demo-TABLEPULSE_WEBHOOK_SECRET-not-for-production";
    const signed = {
      ...prepared,
      signature: createHmac("sha256", secret).update(signedValue).digest("hex"),
    };
    const config = node("Record order and evaluate").parameters;
    const headers = Object.fromEntries(
      config.headerParameters.parameters.map((h) => [
        h.name,
        expression(h.value, signed),
      ]),
    );
    const raw = expression(config.body, signed);
    assert.equal(raw, prepared.rawBody);
    assert.equal(
      (
        await request("/api/offers/evaluate", raw, {
          ...headers,
          "x-tablepulse-signature": "forged",
        })
      ).statusCode,
      401,
    );
    const accepted = await request("/api/offers/evaluate", raw, headers);
    assert.equal(accepted.statusCode, 200);
    const classified = code(
      "Classify backend result",
      accepted,
      event.externalId,
    );
    assert.equal(classified.statusCode, 200);
    assert.ok(
      ["shown", "withheld", "control"].includes(classified.response.outcome),
    );
    const duplicate = code(
      "Classify backend result",
      await request("/api/offers/evaluate", raw, headers),
      event.externalId,
    );
    assert.equal(duplicate.response.outcome, "duplicate");
    const nextEvent = {
      ...event,
      externalId: event.externalId + "-next",
      items: [{ menuItemId: mainItem.id, quantity: 1 }],
    };
    const next = code("Validate order", { body: nextEvent });
    const nextSignature = createHmac("sha256", secret)
      .update(`${next.timestamp}.${next.rawBody}`)
      .digest("hex");
    const nextResponse = await request("/api/offers/evaluate", next.rawBody, {
      "x-tablepulse-timestamp": next.timestamp,
      "x-tablepulse-signature": nextSignature,
    });
    assert.equal(nextResponse.statusCode, 200);
    assert.equal(nextResponse.body.decision.outcome, "withheld");
    assert.ok(
      nextResponse.body.decision.reasons.some((r) => /already/.test(r)),
    );
    const settled = (await request("/api/state")).body;
    assert.equal(
      settled.orders.filter((o) => o.sessionId === session.id).length,
      2,
      "Duplicate must not add another order",
    );
    assert.equal(
      settled.menu.find((m) => m.id === mainItem.id).stock,
      mainItem.stock - 3,
    );
    assert.ok(
      settled.instances.filter((i) => i.sessionId === session.id).length <= 1,
    );
    console.log(
      "Exported n8n contract passed against local TablePulse: signature/forgery, order ingestion, decision classification, duplicate delivery, stock integrity and no reroll. Real n8n import/execution remains untested.",
    );
  } finally {
    assert.equal(
      (
        await request("/api/commands", {
          action: "close",
          sessionId: session.id,
        })
      ).statusCode,
      200,
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
