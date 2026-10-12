import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { evaluate, redeem } from "../lib/engine";
import type { State } from "../lib/types";
test("Postgres migration, seed, atomic offer commit, redemption and RLS", async () => {
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
    const venue = "11111111-1111-4111-8111-111111111111";
    const snapshot = async () => {
      const r = await db.query<{ state: State }>(
        "select tablepulse_snapshot($1) as state",
        [venue],
      );
      return r.rows[0].state;
    };
    const s = await snapshot();
    assert.equal(s.menu.length, 20);
    assert.equal(s.tables.length, 12);
    const margins = await db.query("select * from menu_margins");
    assert.equal(margins.rows.length, 20);
    const session = s.sessions.find((x) => x.tableId.endsWith("000000000105"))!;
    session.customerId = s.customers[0].id;
    session.customerVerified = true;
    assert.equal(
      evaluate(s, session.id, { random: () => 0, requireIdentity: true })
        .outcome,
      "shown",
    );
    const belowMargin = structuredClone(s);
    belowMargin.settings.minMarginPercent = 95;
    await assert.rejects(
      db.query("select tablepulse_commit($1,$2,$3)", [
        venue,
        belowMargin.revision,
        JSON.stringify(belowMargin),
      ]),
      /percentage margin floor/,
    );
    await db.query("select tablepulse_commit($1,$2,$3)", [
      venue,
      s.revision,
      JSON.stringify(s),
    ]);
    const fresh = await snapshot();
    assert.equal(fresh.revision, 1);
    assert.equal(fresh.instances.length, s.instances.length);
    await assert.rejects(
      db.query("select tablepulse_commit($1,$2,$3)", [
        venue,
        s.revision,
        JSON.stringify(s),
      ]),
      /Concurrent venue update/,
    );
    const instance = fresh.instances.find((i) => i.sessionId === session.id)!;
    assert.equal(
      redeem(fresh, session.id, instance.code, "Test staff").ok,
      true,
    );
    await db.query("select tablepulse_commit($1,$2,$3)", [
      venue,
      fresh.revision,
      JSON.stringify(fresh),
    ]);
    const after = await snapshot();
    assert.equal(after.redemptions.length, 2);
    assert.equal(
      after.instances.find((i) => i.id === instance.id)!.status,
      "redeemed",
    );
    const corrupted = structuredClone(after);
    corrupted.instances.find((i) => i.id === instance.id)!.status = "active";
    await assert.rejects(
      db.query("select tablepulse_commit($1,$2,$3)", [
        venue,
        corrupted.revision,
        JSON.stringify(corrupted),
      ]),
      /Terminal reward/,
    );
    assert.equal((await snapshot()).revision, 2);
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select tablepulse_snapshot($1)", [venue]),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.exec("set role authenticated");
    const invisible = await db.query("select * from table_sessions");
    assert.equal(invisible.rows.length, 0);
    await assert.rejects(
      db.query("update venue_users set role='manager'"),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
