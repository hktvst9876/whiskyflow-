import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHmac } from "node:crypto";

const workflow = JSON.parse(
  readFileSync("integrations/n8n/tablepulse-pos-decision.json", "utf8"),
);
const node = (name: string) =>
  workflow.nodes.find((n: { name: string }) => n.name === name);
function run(name: string, input: unknown, externalId = "pos:bill-1:order-2") {
  const result = runInNewContext(
    `(function(){${node(name).parameters.jsCode}\n})()`,
    {
      $input: { first: () => ({ json: input }) },
      $: () => ({ first: () => ({ json: { externalId } }) }),
    },
    { timeout: 1000 },
  );
  return JSON.parse(JSON.stringify(result))[0].json;
}
const event = () => ({
  externalId: "pos:bill-1:order-2",
  sessionId: "00000000-0000-4000-8000-000000000204",
  items: [{ menuItemId: "00000000-0000-4000-8000-000000000009", quantity: 2 }],
  discount: false,
});
test("n8n canonical validation preserves explicit discount status and excludes profiles/decision overrides", () => {
  for (const discount of [false, true]) {
    const result = run("Validate order", { body: { ...event(), discount } });
    assert.equal(result.valid, true);
    assert.equal(JSON.parse(result.rawBody).discount, discount);
  }
  const bad = [
    { ...event(), discount: undefined },
    { ...event(), discount: "false" },
    { ...event(), phone: "+6590000001" },
    { ...event(), ageVerified: true },
    { ...event(), preferredOfferId: "offer" },
    { ...event(), items: [] },
    { ...event(), items: [{ ...event().items[0], quantity: 0 }] },
    { ...event(), items: [{ ...event().items[0], price: 0 }] },
    { ...event(), customerRef: "a" },
    { ...event(), sessionId: "not-a-visit" },
  ];
  for (const body of bad) {
    const result = run("Validate order", { body });
    assert.equal(result.valid, false);
    assert.equal(result.statusCode, 400);
    assert.equal(result.response.error.retryable, false);
  }
});
test("n8n signed bytes match the raw HTTP body, including unicode and quotes", () => {
  const prepared = run("Validate order", {
    body: {
      ...event(),
      externalId: 'pos:料理:"event"',
      customerRef: "member:TP-ABCDEFGH23",
    },
  });
  const signed = `${prepared.timestamp}.${prepared.rawBody}`;
  const signature = createHmac("sha256", "test-signing-secret")
    .update(signed)
    .digest("hex");
  assert.equal(
    signature,
    createHmac("sha256", "test-signing-secret")
      .update(
        `${prepared.timestamp}.${JSON.stringify(JSON.parse(prepared.rawBody))}`,
      )
      .digest("hex"),
  );
  assert.equal(
    node("Record order and evaluate").parameters.body,
    "={{ $json.rawBody }}",
  );
  assert.equal(
    node("Sign TablePulse request").parameters.value,
    "={{ $json.timestamp + '.' + $json.rawBody }}",
  );
});
test("n8n acknowledges shown, withheld, control and duplicate without inventing a decision", () => {
  for (const outcome of ["shown", "withheld", "control"]) {
    const result = run("Classify backend result", {
      statusCode: 200,
      body: {
        ok: true,
        orderId: "order",
        decision: {
          id: "decision",
          outcome,
          offerId: "offer",
          reasons: ["Backend checked rules"],
        },
      },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.response.outcome, outcome);
  }
  const duplicate = run("Classify backend result", {
    statusCode: 200,
    body: { ok: true, duplicate: true, orderId: "existing" },
  });
  assert.equal(duplicate.response.outcome, "duplicate");
  assert.equal(duplicate.response.decisionId, undefined);
  for (const body of [
    { ok: true },
    { ok: true, decision: { outcome: "shown" } },
    { ok: false },
  ]) {
    const invalid = run("Classify backend result", { statusCode: 200, body });
    assert.equal(invalid.statusCode, 502);
    assert.equal(invalid.response.ok, false);
  }
});
test("n8n forwards actionable status without exposing node errors or credentials", () => {
  for (const [statusCode, expected, retryable] of [
    [409, 409, false],
    [401, 502, false],
    [403, 502, false],
    [429, 429, true],
    [500, 503, true],
    [503, 503, true],
  ]) {
    const result = run("Classify backend result", {
      statusCode,
      body: { error: "private-secret" },
    });
    assert.equal(result.statusCode, expected);
    assert.equal(result.response.error.retryable, retryable);
    assert.ok(!JSON.stringify(result).includes("private-secret"));
  }
  const failure = run("Safe service error", {
    error: "private-secret",
    headers: { authorization: "private-secret" },
  });
  assert.equal(failure.statusCode, 503);
  assert.ok(!JSON.stringify(failure).includes("private-secret"));
});
test("n8n import requires authenticated ingress, private Crypto credentials and backend authority", () => {
  assert.equal(workflow.active, false);
  assert.equal(
    node("POS order webhook").parameters.authentication,
    "headerAuth",
  );
  assert.equal(node("Sign TablePulse request").typeVersion, 2);
  assert.equal(node("Sign TablePulse request").parameters.secret, undefined);
  assert.equal(node("Record order and evaluate").parameters.contentType, "raw");
  assert.equal(
    node("Record order and evaluate").parameters.options.redirect.redirect
      .followRedirects,
    false,
  );
  assert.equal(workflow.settings.saveDataSuccessExecution, "none");
  assert.equal(workflow.settings.saveDataErrorExecution, "none");
  assert.ok(
    !workflow.nodes.some((n: { type: string }) =>
      /supabase|postgres|langchain|agent/i.test(n.type),
    ),
  );
});
