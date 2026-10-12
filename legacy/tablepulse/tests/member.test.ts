import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { seed } from "../lib/seed";
import {
  normalizePhone,
  digest,
  ensureMember,
  confirmMemberCheckin,
} from "../lib/member-core";
const key = "test-secret-is-long-enough-for-checkin-testing";
function fixture() {
  const state = seed(),
    session = state.sessions[3],
    member = ensureMember(state, randomUUID());
  const id = randomUUID(),
    code = "783492",
    now = Date.now();
  state.memberCheckins = [
    {
      id,
      sessionId: session.id,
      customerId: member.id,
      codeHash: digest(key, `checkin:${id}:${code}`),
      expiresAt: new Date(now + 300000).toISOString(),
      attempts: 0,
    },
  ];
  return { state, session, member, id, code, now };
}
test("normalization requires explicit international numbering", () => {
  assert.equal(normalizePhone("+65 (8123) 4567"), "+6581234567");
  assert.throws(() => normalizePhone("81234567"));
  assert.throws(() => normalizePhone("+00012345678"));
});
test("repeated verified sign-in keeps the same random membership and customer ID", () => {
  const s = seed(),
    subject = randomUUID(),
    first = ensureMember(s, subject),
    again = ensureMember(s, subject);
  assert.equal(first.id, again.id);
  assert.equal(first.membershipId, again.membershipId);
  assert.match(first.membershipId!, /^TP-[A-HJ-NP-Z2-9]{10}$/);
  assert.equal(first.optedIn, false);
});
test("check-in requires the original table and can be used once", () => {
  const { state, session, member, code, now } = fixture();
  assert.equal(
    confirmMemberCheckin(state, state.sessions[0].id, code, key, "Staff", now)
      .ok,
    false,
  );
  assert.equal(
    confirmMemberCheckin(state, session.id, code, key, "Staff", now).ok,
    true,
  );
  assert.equal(session.customerId, member.id);
  assert.equal(session.customerVerified, true);
  assert.equal(
    confirmMemberCheckin(state, session.id, code, key, "Staff", now).ok,
    false,
  );
});
test("expired or closed visits cannot confirm membership", () => {
  const { state, session, code, now } = fixture();
  assert.equal(
    confirmMemberCheckin(state, session.id, code, key, "Staff", now + 300001)
      .ok,
    false,
  );
  session.closedAt = new Date(now).toISOString();
  assert.equal(
    confirmMemberCheckin(state, session.id, code, key, "Staff", now).ok,
    false,
  );
});
test("member confirmation cannot replace a verified recipient or reset rewards", () => {
  const { state, session, code, now } = fixture();
  session.customerVerified = true;
  session.customerId = state.customers[0].id;
  assert.equal(
    confirmMemberCheckin(state, session.id, code, key, "Staff", now).ok,
    false,
  );
  session.customerVerified = false;
  session.customerId = undefined;
  session.offerReceived = true;
  assert.equal(
    confirmMemberCheckin(state, session.id, code, key, "Staff", now).ok,
    false,
  );
});
test("five rejected check-ins temporarily block a valid code", () => {
  const { state, session, code, now } = fixture();
  for (let n = 0; n < 5; n++)
    confirmMemberCheckin(state, session.id, "000000", key, "Staff", now);
  const result = confirmMemberCheckin(
    state,
    session.id,
    code,
    key,
    "Staff",
    now,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reasons?.[0].includes("Too many"));
});
test("confirmation creates no offer and preserves consumed opportunity", () => {
  const { state, session, code, now } = fixture();
  session.rewardAttemptedAt = new Date(now - 1000).toISOString();
  const count = state.instances.length;
  confirmMemberCheckin(state, session.id, code, key, "Staff", now);
  assert.equal(state.instances.length, count);
  assert.equal(session.rewardAttemptedAt, new Date(now - 1000).toISOString());
});
