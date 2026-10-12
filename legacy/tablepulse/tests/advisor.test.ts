import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../lib/seed";
import { buildAdvisorContext, responseText } from "../lib/advisor-core";
import { offerCandidates } from "../lib/engine";

test("advisor receives category summaries only when the linked customer opted in", () => {
  const state = seed(),
    session = state.sessions[3],
    customer = state.customers[0];
  session.customerId = customer.id;
  session.customerVerified = true;
  state.sessions[4].customerId = customer.id;
  state.sessions[4].customerVerified = true;
  state.instances = [];
  state.history = [];
  state.sessions.forEach((visit) => {
    visit.offerReceived = false;
    visit.control = false;
  });
  const candidates = offerCandidates(state, session.id).candidates;
  const context = buildAdvisorContext(state, session.id, candidates);
  assert.deepEqual(context.customerContext?.explicitPreferences, [
    "zero_alcohol",
    "food",
  ]);
  assert.equal(context.customerContext?.associatedVisitCount, 1);
  assert.ok(context.customerContext?.associatedPurchaseCategories.food);
  const serialized = JSON.stringify(context);
  assert.ok(!serialized.includes(customer.id));
  assert.ok(!serialized.includes("membershipId"));
  assert.ok(!serialized.includes("authUserId"));
  assert.ok(!serialized.includes("itemName"));
  assert.ok(!serialized.includes("offerName"));

  customer.optedIn = false;
  assert.equal(
    buildAdvisorContext(state, session.id, candidates).customerContext,
    null,
  );
});

test("Responses API text extraction accepts structured output and rejects other shapes", () => {
  assert.equal(
    responseText({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: '{"offer_id":"NO_OFFER"}' }],
        },
      ],
    }),
    '{"offer_id":"NO_OFFER"}',
  );
  assert.equal(
    responseText({ output: [{ content: [{ text: "unsafe" }] }] }),
    undefined,
  );
});
