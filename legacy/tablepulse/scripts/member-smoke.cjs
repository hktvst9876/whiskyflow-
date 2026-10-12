// Membership HTTP checks use disposable, explicitly enabled demo data only.
const assert = require("node:assert/strict");
const base = process.env.TABLEPULSE_TEST_URL ?? "http://127.0.0.1:3001";
async function request(path, body, cookie, origin = base) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
    cookies: response.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; "),
  };
}
const member = (body, cookie, origin) =>
  request("/api/member", body, cookie, origin);
async function register(phone) {
  const challenge = await member({ action: "request_otp", phone });
  assert.equal(challenge.status, 200);
  assert.equal(challenge.body.mode, "demo");
  const proof = {
    action: "verify_otp",
    phone,
    challengeId: challenge.body.challengeId,
    code: challenge.body.demoCode,
  };
  const wrong = proof.code === "000000" ? "111111" : "000000";
  assert.equal((await member({ ...proof, code: wrong })).status, 400);
  const verified = await member(proof);
  assert.equal(verified.status, 200);
  assert.match(verified.cookies, /tablepulse-demo-member=/);
  assert.equal((await member(proof)).status, 400, "OTP must be single-use");
  assert.equal((await member({ action: "request_otp", phone })).status, 429);
  return verified.cookies;
}
async function main() {
  assert.equal(
    (await request("/api/state")).body.mode,
    "demo",
    "Never run against live data",
  );
  await request("/api/demo/reset", {});
  try {
    assert.equal((await member()).body.member, null);
    assert.equal(
      (await member({ action: "preferences", optedIn: true, preferences: [] }))
        .status,
      401,
    );
    assert.equal(
      (await member({ action: "request_otp", phone: "81234567" })).status,
      400,
    );
    assert.equal(
      (
        await member(
          { action: "request_otp", phone: "+6590000001" },
          undefined,
          "https://evil.example",
        )
      ).status,
      403,
    );
    const cookie = await register("+6590000001");
    const account = (await member(undefined, cookie)).body;
    assert.match(account.member.membershipId, /^TP-[A-HJ-NP-Z2-9]{10}$/);
    assert.equal(account.member.optedIn, false);
    assert.deepEqual(account.visits, []);
    assert.equal(account.member.authUserId, undefined);
    assert.equal(account.member.phone, undefined);
    assert.equal(
      (
        await member(
          {
            action: "preferences",
            optedIn: true,
            preferences: ["food", "zero_alcohol"],
          },
          cookie,
        )
      ).status,
      200,
    );
    assert.deepEqual(
      (await member(undefined, cookie)).body.member.preferences,
      ["food", "zero_alcohol"],
    );
    const state = (await request("/api/state")).body;
    const sessions = state.sessions.filter(
      (s) => !s.closedAt && !s.customerVerified && !s.offerReceived,
    );
    assert.ok(sessions.length >= 2);
    const session = sessions[0],
      other = sessions[1];
    const token = state.displayTokens[session.id];
    const checkin = await member({ action: "checkin", token }, cookie);
    assert.equal(checkin.status, 200);
    assert.match(checkin.body.checkinCode, /^\d{6}$/);
    assert.equal(
      (await member({ action: "checkin_status", token }, cookie)).body
        .confirmed,
      false,
    );
    assert.equal(
      (
        await request("/api/commands", {
          action: "confirm_member",
          sessionId: other.id,
          code: checkin.body.checkinCode,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/api/commands", {
          action: "confirm_member",
          sessionId: session.id,
          code: checkin.body.checkinCode,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/api/commands", {
          action: "confirm_member",
          sessionId: session.id,
          code: checkin.body.checkinCode,
        })
      ).status,
      409,
    );
    assert.equal(
      (await member({ action: "checkin_status", token }, cookie)).body
        .confirmed,
      true,
    );
    assert.equal((await member(undefined, cookie)).body.visits.length, 1);
    const linked = (await request("/api/state")).body;
    assert.equal(
      linked.instances.length,
      state.instances.length,
      "Joining must not create a reward",
    );
    assert.equal(
      linked.sessions.find((s) => s.id === session.id).membershipId,
      account.member.membershipId,
    );
    assert.deepEqual(linked.memberCheckins, []);
    assert.deepEqual(linked.demoOtps, []);
    assert.ok(linked.customers.every((c) => !c.authUserId));
    assert.equal(
      (
        await request("/api/enrol", {
          token,
          consent: true,
          preferences: ["beer"],
        })
      ).status,
      403,
    );
    const secondCookie = await register("+6590000002");
    const second = (await member(undefined, secondCookie)).body;
    assert.notEqual(second.member.membershipId, account.member.membershipId);
    assert.deepEqual(second.visits, []);
    assert.equal(
      (await member({ action: "checkin", token }, secondCookie)).status,
      409,
    );
    assert.equal(
      (await member(undefined, "tablepulse-demo-member=forged")).body.member,
      null,
    );
    assert.equal(
      (
        await member(
          { action: "preferences", optedIn: false, preferences: [] },
          cookie,
        )
      ).status,
      200,
    );
    assert.deepEqual(
      (await member(undefined, cookie)).body.member.preferences,
      [],
    );
    const logout = await member({ action: "logout" }, cookie);
    assert.equal(logout.status, 200);
    assert.equal((await member(undefined, logout.cookies)).body.member, null);
    console.log(
      "Membership HTTP checks passed: OTP limits/replay, consent, private profiles, table-scoped one-use confirmation, no automatic reward, account isolation and logout.",
    );
  } finally {
    await request("/api/demo/reset", {});
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
