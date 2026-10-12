import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { ensureMember, digest, confirmMemberCheckin } from "../lib/member-core";
import type { State } from "../lib/types";
test("member migration persists check-in, protects identities and private rows, and enforces SMS budget", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$; create publication supabase_realtime;`,
    );
    await db.exec(
      readFileSync("supabase/migrations/202610070001_tablepulse.sql", "utf8"),
    );
    await db.exec(
      readFileSync("supabase/migrations/202610080001_members.sql", "utf8"),
    );
    await db.exec(
      readFileSync("supabase/migrations/202610090001_agent_margin.sql", "utf8"),
    );
    await db.exec(readFileSync("supabase/seed.sql", "utf8"));
    const venue = "11111111-1111-4111-8111-111111111111",
      user = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      checkinId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await db.query("insert into auth.users(id) values($1)", [user]);
    const snapshot = async () =>
      (
        await db.query<{ state: State }>(
          "select tablepulse_snapshot($1) state",
          [venue],
        )
      ).rows[0].state;
    const commit = (s: State) =>
      db.query("select tablepulse_commit($1,$2,$3)", [
        venue,
        s.revision,
        JSON.stringify(s),
      ]);
    const s = await snapshot(),
      member = ensureMember(s, user),
      session = s.sessions.find(
        (v) => !v.offerReceived && !v.customerVerified,
      )!;
    const key = "db-test-key",
      code = "938475";
    s.memberCheckins = [
      {
        id: checkinId,
        customerId: member.id,
        sessionId: session.id,
        codeHash: digest(key, `checkin:${checkinId}:${code}`),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        attempts: 0,
      },
    ];
    await commit(s);
    const fresh = await snapshot();
    assert.equal(fresh.memberCheckins?.length, 1);
    assert.equal(
      confirmMemberCheckin(fresh, session.id, code, key, "Staff").ok,
      true,
    );
    fresh.sessions.find((v) => v.id === session.id)!.rewardAttemptedAt =
      new Date().toISOString();
    await commit(fresh);
    const settled = await snapshot();
    assert.ok(settled.memberCheckins![0].consumedAt);
    const corrupt = structuredClone(settled);
    corrupt.customers.find((c) => c.id === member.id)!.membershipId =
      "TP-AAAAAAAAAA";
    await assert.rejects(commit(corrupt), /Membership number is immutable/);
    const swappedIdentity = structuredClone(settled);
    swappedIdentity.customers.find((c) => c.id === member.id)!.authUserId =
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await assert.rejects(
      commit(swappedIdentity),
      /Member identity is immutable/,
    );
    const reset = structuredClone(settled);
    delete reset.sessions.find((v) => v.id === session.id)!.rewardAttemptedAt;
    await assert.rejects(commit(reset), /Cannot reset reward opportunity/);
    const doubleReward = structuredClone(settled);
    const otherVisit = doubleReward.sessions.find(
      (v) => v.id !== session.id && !v.customerVerified && !v.offerReceived,
    )!;
    otherVisit.customerId = member.id;
    otherVisit.customerVerified = true;
    [session.id, otherVisit.id].forEach((sessionId, i) => {
      doubleReward.instances.push({
        ...doubleReward.instances[0],
        id: `ffffffff-ffff-4fff-8fff-fffffffffff${i}`,
        sessionId,
        status: "active",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
    });
    await assert.rejects(
      commit(doubleReward),
      /Customer already has an active reward/,
    );
    assert.equal(
      (await snapshot()).revision,
      settled.revision,
      "Rejected writes must roll back",
    );
    const allow = async () =>
      (
        await db.query<{ allowed: boolean }>(
          "select tablepulse_auth_allow($1,'test-sms',3600,2) allowed",
          [venue],
        )
      ).rows[0].allowed;
    assert.equal(await allow(), true);
    assert.equal(await allow(), true);
    assert.equal(await allow(), false);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select * from member_checkins"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select tablepulse_auth_allow($1,'test',60,1)", [venue]),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
