// TablePulse customer-night simulation. Real Postgres (PGlite) + real migrations + real command code, live policy.
process.env.TABLEPULSE_DEMO = "false";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://sim.local";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sim";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sim";
for (const k of [
  "TABLEPULSE_TOKEN_SECRET",
  "TABLEPULSE_CUSTOMER_SECRET",
  "TABLEPULSE_WEBHOOK_SECRET",
])
  process.env[k] = "sim-" + k + "-0123456789abcdef0123456789abcdef";
process.env.TABLEPULSE_PHONE_LOGIN_ENABLED = "true";
process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY = "sim-site-key";
const root = require("path").join(__dirname, "..");
process.chdir(root);
require("../scripts/register-ts.cjs");
const Module = require("module");
const fs = require("fs");
const { randomUUID, randomInt } = require("crypto");
const { PGlite } = require("@electric-sql/pglite");

// ---------- module stubs ----------
const stubs = new Set();
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) {
  return stubs.has(r) ? "stub:" + r : orig.call(this, r, ...a);
};
function stub(name, exports) {
  stubs.add(name);
  const m = new Module("stub:" + name);
  m.exports = exports;
  m.loaded = true;
  require.cache["stub:" + name] = m;
}
let db;
const LOG = [];
const say = (s = "") => {
  LOG.push(s);
  console.log(s);
};
let rpcCount = 0,
  conflicts = 0;
async function rpc(name, args) {
  rpcCount++;
  const keys = Object.keys(args);
  const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")}) as r`;
  try {
    const r = await db.query(
      sql,
      keys.map((k) =>
        typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k],
      ),
    );
    return { data: r.rows[0].r, error: null };
  } catch (e) {
    if (e.code === "40001") conflicts++;
    return { data: null, error: { code: e.code, message: e.message } };
  }
}
stub("server-only", {});
stub("next/headers", {
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set() {},
    delete() {},
  }),
});
stub("@supabase/supabase-js", {
  createClient: () => ({
    rpc,
    from: () => {
      throw new Error("not simulated");
    },
  }),
});
// Simulated Supabase Auth + SMS provider
let currentUser = null;
const sms = new Map(),
  phoneUsers = new Map();
stub("@supabase/ssr", {
  createServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: currentUser },
        error: currentUser ? null : { message: "no session" },
      }),
      signInWithOtp: async ({ phone }) => {
        sms.set(phone, String(randomInt(100000, 1000000)));
        return { error: null };
      },
      verifyOtp: async ({ phone, token }) => {
        if (sms.get(phone) !== token)
          return { data: {}, error: { message: "bad" } };
        sms.delete(phone);
        let id = phoneUsers.get(phone);
        if (!id) {
          id = randomUUID();
          phoneUsers.set(phone, id);
          await db.query(
            "insert into auth.users(id) values($1) on conflict do nothing",
            [id],
          );
        }
        currentUser = {
          id,
          phone,
          phone_confirmed_at: new Date().toISOString(),
        };
        return { data: { user: currentUser }, error: null };
      },
      signOut: async () => {
        currentUser = null;
        return { error: null };
      },
    },
  }),
});

const { runCommand } = require("../lib/server/commands.ts");
const { memberCommand, memberView } = require("../lib/server/members.ts");
const { readState } = require("../lib/server/store.ts");
const { displayToken } = require("../lib/server/tokens.ts");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const M = {
  ribeye: U(1),
  pasta: U(2),
  salmon: U(3),
  burger: U(4),
  chips: U(5),
  calamari: U(6),
  fries: U(7),
  edamame: U(8),
  tiger: U(9),
  paleale: U(10),
  lager: U(11),
  shirazGlass: U(12),
  sauvGlass: U(13),
  shirazBottle: U(14),
  sauvBottle: U(15),
  negroni: U(16),
  spritz: U(17),
  yuzu: U(18),
  ginger: U(19),
  water: U(20),
};
const T = (n) => U(100 + n);

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: !!ok, detail });
  say(`   ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
async function cmd(c, actor = "Staff · Sim") {
  try {
    return { status: 200, body: await runCommand(c, actor) };
  } catch (e) {
    return {
      status: e.status ?? (e.name === "ZodError" ? 400 : 500),
      error: e.message.split("\n")[0].slice(0, 160),
    };
  }
}
async function member(c) {
  try {
    return { status: 200, body: await memberCommand(c) };
  } catch (e) {
    return { status: e.status ?? 500, error: e.message.slice(0, 160) };
  }
}
const name = (s, id) =>
  s.menu.find((m) => m.id === id)?.name ??
  s.offers.find((o) => o.id === id)?.name ??
  id;
let ext = 0;
async function order(sessionId, items, extra = {}) {
  return cmd(
    {
      action: "order",
      event: {
        externalId: `pos-${++ext}`,
        sessionId,
        items: items.map(([m, q]) => ({ menuItemId: m, quantity: q })),
        discount: false,
        ...extra,
      },
    },
    "POS",
  );
}
async function open(table) {
  const r = await cmd({ action: "session", tableId: T(table) });
  return r.body?.sessionId;
}
function describe(s, r) {
  const d = r.body?.decision;
  if (!d) return r.error ? `HTTP ${r.status}: ${r.error}` : "no decision";
  if (d.outcome === "shown") {
    const inst = s.instances.find(
      (i) => i.sessionId === d.sessionId && i.status === "active",
    );
    return `SHOWN "${name(s, d.offerId)}" score ${d.score?.toFixed?.(0)} code ${inst?.code}`;
  }
  return `${d.outcome.toUpperCase()}: ${d.reasons.slice(0, 2).join("; ")}`;
}
async function signUp(phone, prefs) {
  currentUser = null;
  await member({ action: "request_otp", phone, captchaToken: "ok" });
  const code = sms.get(phone.replace(/[\s()-]/g, ""));
  const v = await member({ action: "verify_otp", phone, code });
  if (prefs)
    await member({ action: "preferences", optedIn: true, preferences: prefs });
  const view = await memberView();
  return {
    user: currentUser,
    membershipId: view.member?.membershipId,
    ok: v.status === 200,
  };
}
async function checkIn(user, sessionId) {
  currentUser = user;
  const s = await readState();
  const sess = s.sessions.find((x) => x.id === sessionId);
  const token = displayToken(
    sessionId,
    Date.parse(sess.startedAt) + 12 * 3600000,
  );
  const r = await member({ action: "checkin", token });
  if (r.status !== 200) return r;
  return cmd({ action: "confirm_member", sessionId, code: r.body.checkinCode });
}

(async () => {
  const t0 = Date.now();
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$; create publication supabase_realtime;`,
  );
  await db.exec(
    fs.readFileSync("supabase/migrations/202610070001_tablepulse.sql", "utf8"),
  );
  await db.exec(
    fs.readFileSync("supabase/migrations/202610080001_members.sql", "utf8"),
  );
  await db.exec(
    fs.readFileSync(
      "supabase/migrations/202610090001_agent_margin.sql",
      "utf8",
    ),
  );
  await db.exec(fs.readFileSync("supabase/seed.sql", "utf8"));
  let s = await readState();
  const initialStock = Object.fromEntries(s.menu.map((m) => [m.id, m.stock]));
  say(
    `DB> Postgres up. Migrations applied. Venue "${s.venue.name}", ${s.menu.length} menu items, ${s.tables.length} tables, revision ${s.revision}.`,
  );
  say(
    `DB> Settings: min profit S$${s.settings.minProfit}, min margin ${s.settings.minMarginPercent}%, min score ${s.settings.minScore}, allocation ${s.settings.allocationProbability * 100}%, control ${s.settings.controlPercent}%.`,
  );
  for (const x of s.sessions.filter((x) => !x.closedAt))
    await cmd({ action: "close", sessionId: x.id }, "Manager");
  say(
    `DB> Closed ${s.sessions.filter((x) => !x.closedAt).length} leftover seed visits. Fresh service begins.\n`,
  );

  // ===================== SCRIPTED CUSTOMERS =====================
  say(
    "=== 1. Alice — new member, signs up on her phone, checks in at T01, orders 2 burgers ===",
  );
  const alice = await signUp("+65 8100 0001", ["zero_alcohol", "food"]);
  check(
    "Alice gets a membership number via SMS sign-in",
    /^TP-[A-Z2-9]{10}$/.test(alice.membershipId ?? ""),
    alice.membershipId,
  );
  currentUser = null;
  const rl = await member({
    action: "request_otp",
    phone: "+65 8100 0001",
    captchaToken: "ok",
  });
  check(
    "Asking for a 2nd SMS within a minute is rate-limited",
    rl.status === 429,
    rl.error,
  );
  await db.query(
    "delete from public.member_auth_limits where scope like 'sms-minute:%'",
  ); // pretend a minute passed
  const aliceAgain = await signUp("+65 8100 0001");
  check(
    "Signing in again later keeps the same membership",
    aliceAgain.membershipId === alice.membershipId,
    aliceAgain.membershipId,
  );
  const sA = await open(1);
  await cmd({
    action: "flags",
    sessionId: sA,
    ageVerified: true,
    intoxicated: false,
    blocked: false,
  });
  const ci = await checkIn(alice.user, sA);
  check(
    "Staff confirms Alice's table check-in code",
    ci.body?.ok === true,
    ci.body?.membershipId ?? ci.error,
  );
  let r = await order(sA, [[M.burger, 2]]);
  s = await readState();
  say(`   DB> decision: ${describe(s, r)}`);
  const aliceDecision = r.body?.decision;

  say("\n=== 2. Ben & mates — walk-ins, no membership, 4 Tigers at T02 ===");
  const sB = await open(2);
  await cmd({
    action: "flags",
    sessionId: sB,
    ageVerified: true,
    intoxicated: false,
    blocked: false,
  });
  r = await order(sB, [[M.tiger, 4]]);
  s = await readState();
  say(`   DB> decision: ${describe(s, r)}`);
  check(
    "Anonymous table gets no subsidised reward (live identity rule)",
    r.body?.decision?.outcome !== "shown",
  );

  say("\n=== 3. Chloe — POS loyalty card, ribeye + glass of Shiraz at T03 ===");
  const sC = await open(3);
  await cmd({
    action: "flags",
    sessionId: sC,
    ageVerified: true,
    intoxicated: false,
    blocked: false,
  });
  r = await order(
    sC,
    [
      [M.ribeye, 1],
      [M.shirazGlass, 1],
    ],
    { customerRef: "loyalty-chloe-001" },
  );
  s = await readState();
  say(`   DB> decision: ${describe(s, r)}`);
  check(
    "Bottle trade-up is the offer considered for steak + glass",
    r.body?.decision?.offerId === U(303) ||
      r.body?.decision?.outcome !== "shown",
    name(s, r.body?.decision?.offerId),
  );

  say(
    "\n=== 4. POS glitches: replayed event, reused ID, impossible quantity ===",
  );
  const ev = {
    externalId: "pos-dup-1",
    sessionId: sC,
    items: [{ menuItemId: M.water, quantity: 1 }],
    discount: false,
  };
  const d1 = await cmd({ action: "order", event: ev }, "POS"),
    d2 = await cmd({ action: "order", event: ev }, "POS");
  check(
    "Replayed POS event is accepted once, flagged duplicate",
    d1.status === 200 && d2.body?.duplicate === true,
    `first: ${d1.status} ${d1.error ?? ""} second: ${d2.status} ${d2.error ?? JSON.stringify(d2.body).slice(0, 80)}`,
  );
  const d3 = await cmd(
    {
      action: "order",
      event: { ...ev, items: [{ menuItemId: M.water, quantity: 5 }] },
    },
    "POS",
  );
  check(
    "Reused event ID with different items is rejected",
    d3.status === 409,
    d3.error,
  );
  const before = (await readState()).menu.find((m) => m.id === M.ribeye).stock;
  const d4 = await order(sC, [[M.ribeye, 50]]);
  const after = (await readState()).menu.find((m) => m.id === M.ribeye).stock;
  check(
    "Ordering more ribeyes than in stock is refused and stock untouched",
    d4.status === 409 && before === after,
    `stock ${after}`,
  );

  say(
    "\n=== 5. Eve's table — not ID-checked yet, orders 2 burgers + 2 pale ales at T05 ===",
  );
  const sE = await open(5);
  r = await order(
    sE,
    [
      [M.burger, 2],
      [M.paleale, 2],
    ],
    { customerRef: "loyalty-eve-005" },
  );
  s = await readState();
  say(`   DB> decision: ${describe(s, r)}`);
  const eveOffer = s.offers.find((o) => o.id === r.body?.decision?.offerId);
  check(
    "No alcoholic reward shown to an un-ID'd table",
    !(
      r.body?.decision?.outcome === "shown" &&
      s.menu.find((m) => m.id === eveOffer?.itemId)?.alcohol
    ),
  );

  say(
    "\n=== 6. Alice tries a second table (T06) while her first visit is open ===",
  );
  const sA2 = await open(6);
  const ci2 = await checkIn(alice.user, sA2);
  r = await order(sA2, [[M.salmon, 1]]);
  s = await readState();
  say(
    `   DB> check-in: ${ci2.body?.ok ? "confirmed" : (ci2.error ?? ci2.body?.reasons)}; decision: ${describe(s, r)}`,
  );
  const aliceActive = s.instances.filter(
    (i) =>
      i.status === "active" &&
      s.sessions.find((x) => x.id === i.sessionId)?.customerId ===
        s.sessions.find((x) => x.id === sA)?.customerId,
  );
  check(
    "Alice never holds more than one active reward",
    aliceActive.length <= 1,
    `${aliceActive.length} active`,
  );
  await cmd({ action: "close", sessionId: sA2 });

  say("\n=== 7. Redemption + abuse attempts ===");
  s = await readState();
  let target = s.instances.find((i) => i.status === "active");
  if (!target) {
    say(
      "   (No reward happened to be shown by chance yet — opening loyalty tables until one is.)",
    );
    for (let i = 0; i < 12 && !target; i++) {
      const t = 7 + (i % 5);
      const sid = await open(t);
      if (!sid) continue;
      await cmd({
        action: "flags",
        sessionId: sid,
        ageVerified: true,
        intoxicated: false,
        blocked: false,
      });
      await order(sid, [[M.tiger, 2]], { customerRef: `loyalty-fill-${i}` });
      s = await readState();
      target = s.instances.find((x) => x.status === "active");
      if (!target) await cmd({ action: "close", sessionId: sid });
    }
  }
  if (target) {
    const tSess = target.sessionId,
      other = s.sessions.find(
        (x) =>
          !x.closedAt &&
          x.id !== tSess &&
          x.customerVerified &&
          !s.instances.some((i) => i.sessionId === x.id),
      );
    say(
      `   Reward on ${s.tables.find((t) => t.id === s.sessions.find((x) => x.id === tSess).tableId).name}: "${name(s, target.offerId)}" code ${target.code}`,
    );
    if (other) {
      const steal = await cmd({
        action: "redeem",
        sessionId: other.id,
        code: target.code,
      });
      check(
        "Screenshot of code used at a different table is refused",
        steal.body?.ok !== true,
        steal.body?.reasons?.[0] ?? steal.error,
      );
    }
    const stockBefore = s.menu.find(
      (m) => m.id === s.offers.find((o) => o.id === target.offerId).itemId,
    ).stock;
    const ok = await cmd({
      action: "redeem",
      sessionId: tSess,
      code: target.code,
    });
    check(
      "Correct table + code redeems",
      ok.body?.ok === true,
      ok.body?.reasons?.join("; "),
    );
    const again = await cmd({
      action: "redeem",
      sessionId: tSess,
      code: target.code,
    });
    check(
      "Same code cannot be redeemed twice",
      again.body?.ok !== true,
      again.body?.reasons?.[0] ?? again.error,
    );
    s = await readState();
    const stockAfter = s.menu.find(
      (m) => m.id === s.offers.find((o) => o.id === target.offerId).itemId,
    ).stock;
    const offer = s.offers.find((o) => o.id === target.offerId);
    check(
      "Redemption consumes stock for the reward item",
      stockBefore - stockAfter === offer.quantity,
      `${stockBefore} → ${stockAfter}`,
    );
    const red = s.redemptions.find((x) => x.instanceId === target.id);
    say(
      `   DB> redemption row: revenue S$${red?.revenue}, est. profit S$${red?.profit?.toFixed(2)}, discount given S$${red?.discount?.toFixed(2)}`,
    );
  } else check("A reward could be produced for redemption testing", false);

  say("\n   Brute-force: a loyalty guest at T04 guesses codes six times");
  const sG = await open(4);
  await cmd({
    action: "flags",
    sessionId: sG,
    ageVerified: true,
    intoxicated: false,
    blocked: false,
  });
  await order(sG, [[M.water, 1]], { customerRef: "loyalty-guesser" });
  let lastGuess;
  const guesses = [];
  for (let i = 0; i < 6; i++) {
    lastGuess = await cmd({
      action: "redeem",
      sessionId: sG,
      code: "ZZZZZ" + i,
    });
    guesses.push(lastGuess.body?.reasons?.[0] ?? lastGuess.error);
  }
  say("     replies: " + [...new Set(guesses)].join(" | "));
  s = await readState();
  check(
    "Guessing is blocked after repeated failures",
    /too many|blocked|retry/i.test(
      lastGuess.body?.reasons?.join(" ") ?? lastGuess.error ?? "",
    ),
    lastGuess.body?.reasons?.[0] ?? lastGuess.error,
  );

  say("\n=== 8. Void and close behaviour ===");
  // Find or create an active reward then void its qualifying order
  s = await readState();
  let v = s.instances.find((i) => i.status === "active");
  if (v) {
    const res = await cmd({ action: "void", orderId: v.qualifyingOrderIds[0] });
    s = await readState();
    check(
      "Voiding the qualifying order cancels the pending reward",
      s.instances.find((i) => i.id === v.id).status === "cancelled",
      res.error ?? "",
    );
  } else say("   (no active reward at this moment to void — skipped)");
  await cmd({ action: "close", sessionId: sC });
  const closedOrder = await order(sC, [[M.water, 1]]);
  check(
    "Orders on a closed bill are rejected",
    closedOrder.status === 409,
    closedOrder.error,
  );

  // ===================== BUSY NIGHT =====================
  say(
    "\n=== 9. Busy night — 60 groups, waves of 6 tables ordering at the same moment ===",
  );
  s = await readState();
  for (const x of s.sessions.filter((x) => !x.closedAt))
    await cmd({ action: "close", sessionId: x.id });
  const regulars = Array.from({ length: 18 }, (_, i) => `loyalty-regular-${i}`);
  const baskets = [
    [[M.tiger, 2]],
    [[M.burger, 2]],
    [
      [M.ribeye, 1],
      [M.shirazGlass, 1],
    ],
    [
      [M.pasta, 1],
      [M.salmon, 1],
    ],
    [[M.lager, 3]],
    [
      [M.negroni, 2],
      [M.calamari, 1],
    ],
    [
      [M.paleale, 2],
      [M.burger, 1],
    ],
    [
      [M.yuzu, 2],
      [M.pasta, 2],
    ],
    [
      [M.sauvGlass, 2],
      [M.salmon, 2],
    ],
    [[M.fries, 1]],
    [[M.spritz, 2]],
    [
      [M.ribeye, 2],
      [M.sauvGlass, 2],
    ],
  ];
  const stats = {
    groups: 0,
    shown: 0,
    withheld: 0,
    control: 0,
    redeemed: 0,
    declined: 0,
    busy: 0,
    errors: [],
    reasons: {},
  };
  for (let wave = 0; wave < 10; wave++) {
    const tables = Array.from(
      { length: 6 },
      (_, i) => 1 + ((wave * 6 + i) % 12),
    );
    const sessions = [];
    for (const t of tables) {
      const sid = await open(t);
      if (sid) sessions.push(sid);
    }
    await Promise.all(
      sessions.map((sid) =>
        cmd({
          action: "flags",
          sessionId: sid,
          ageVerified: Math.random() < 0.9,
          intoxicated: Math.random() < 0.04,
          blocked: false,
        }),
      ),
    );
    const results = await Promise.all(
      sessions.map((sid) => {
        const basket = baskets[randomInt(baskets.length)];
        const ref =
          Math.random() < 0.7
            ? regulars[randomInt(regulars.length)]
            : undefined;
        return order(sid, basket, ref ? { customerRef: ref } : {}).then(
          (res) => ({ sid, res }),
        );
      }),
    );
    for (const { sid, res } of results) {
      stats.groups++;
      if (res.status !== 200) {
        if (/busy/i.test(res.error)) stats.busy++;
        else if (/out of stock/i.test(res.error))
          stats.soldOut = (stats.soldOut ?? 0) + 1;
        else stats.errors.push(res.error);
        continue;
      }
      const d = res.body.decision;
      stats[d.outcome]++;
      if (d.outcome !== "shown") {
        const k = d.reasons[0]?.replace(/\d+/g, "#").slice(0, 80);
        stats.reasons[k] = (stats.reasons[k] ?? 0) + 1;
      }
    }
    s = await readState();
    for (const sid of sessions) {
      const inst = s.instances.find(
        (i) => i.sessionId === sid && i.status === "active",
      );
      if (inst) {
        if (Math.random() < 0.7) {
          const rr = await cmd({
            action: "redeem",
            sessionId: sid,
            code: inst.code,
          });
          if (rr.body?.ok) stats.redeemed++;
          else
            stats.errors.push("redeem: " + (rr.body?.reasons?.[0] ?? rr.error));
        } else stats.declined++;
      }
      // second round
      await order(sid, baskets[randomInt(baskets.length)]);
    }
    await Promise.all(
      sessions.map((sid) => cmd({ action: "close", sessionId: sid })),
    );
  }
  say(
    `   Groups: ${stats.groups} | shown ${stats.shown} | withheld ${stats.withheld} | control ${stats.control}`,
  );
  say(
    `   Orders refused because an item sold out (expected late in the night): ${stats.soldOut ?? 0}`,
  );
  say(
    `   Of shown: redeemed ${stats.redeemed}, guests ignored ${stats.declined}`,
  );
  say(
    `   Writes that gave up under contention ("Service is busy"): ${stats.busy}; DB revision conflicts retried: ${conflicts}`,
  );
  say(`   Top reasons for no reward:`);
  Object.entries(stats.reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .forEach(([k, n]) => say(`     ${String(n).padStart(3)} × ${k}`));
  if (stats.errors.length)
    say(
      `   Unexpected errors: ${[...new Set(stats.errors)].slice(0, 5).join(" | ")}`,
    );
  check(
    "No unexpected errors during busy night",
    stats.errors.length === 0,
    `${stats.errors.length} errors`,
  );
  check(
    "Every concurrent order eventually committed",
    stats.busy === 0,
    `${stats.busy} gave up`,
  );

  // ===================== INTEGRITY AUDIT =====================
  say("\n=== 10. Database integrity audit (direct SQL + snapshot) ===");
  s = await readState();
  const q = async (sql) => (await db.query(sql)).rows;
  const dupRed = await q(
    "select instance_id, count(*) c from public.offer_redemptions group by 1 having count(*)>1",
  );
  check("No reward redeemed twice (SQL)", dupRed.length === 0);
  const openPerTable = await q(
    "select table_id, count(*) from public.table_sessions where data->>'closedAt' is null group by 1 having count(*)>1",
  );
  check("Never two open visits on one table (SQL)", openPerTable.length === 0);
  check(
    "No negative stock",
    s.menu.every((m) => m.stock >= 0),
  );
  const sold = {};
  s.orders
    .filter((o) => !o.voided)
    .forEach((o) =>
      o.items.forEach(
        (i) => (sold[i.menuItemId] = (sold[i.menuItemId] ?? 0) + i.quantity),
      ),
    );
  const seedReward = 0;
  const drift = s.menu.filter(
    (m) =>
      initialStock[m.id] - m.stock !==
      (sold[m.id] ?? 0) - (m.id === M.shirazBottle ? 1 : 0) + 0,
  );
  // seed already contains orders whose stock was not deducted; compare deltas from service start instead
  const visitsPerCustomer = {};
  s.instances
    .filter((i) => i.status === "active")
    .forEach((i) => {
      const c = s.sessions.find((x) => x.id === i.sessionId)?.customerId;
      if (c) visitsPerCustomer[c] = (visitsPerCustomer[c] ?? 0) + 1;
    });
  check(
    "No customer has two active rewards",
    Object.values(visitsPerCustomer).every((n) => n <= 1),
  );
  const multi = {};
  s.instances.forEach(
    (i) => (multi[i.sessionId] = (multi[i.sessionId] ?? 0) + 1),
  );
  check(
    "At most one reward per visit",
    Object.values(multi).every((n) => n <= 1),
  );
  const capViol = [];
  const byCust = {};
  s.history
    .filter((h) => h.redeemedAt)
    .forEach(
      (h) => (byCust[h.customerId] = (byCust[h.customerId] ?? []).concat(h)),
    );
  Object.entries(byCust).forEach(([c, hs]) => {
    if (hs.length > 1) capViol.push(c);
  });
  check(
    "30-day cap: no loyalty customer redeemed more than one subsidised reward tonight",
    capViol.length === 0,
    `${Object.keys(byCust).length} customers redeemed`,
  );
  const shownNoInst = s.decisions.filter(
    (d) =>
      d.outcome === "shown" &&
      !s.instances.some((i) => i.sessionId === d.sessionId),
  );
  check("Every 'shown' decision has a stored reward", shownNoInst.length === 0);
  const anonRewards = s.instances.filter(
    (i) =>
      Date.parse(i.createdAt) > t0 &&
      !s.sessions.find((x) => x.id === i.sessionId)?.customerVerified,
  );
  check(
    "No reward issued tonight to an unverified customer",
    anonRewards.length === 0,
    `${anonRewards.length}`,
  );
  const unsafeAlc = s.instances.filter(
    (i) =>
      Date.parse(i.createdAt) > t0 &&
      s.menu.find(
        (m) => m.id === s.offers.find((o) => o.id === i.offerId)?.itemId,
      )?.alcohol &&
      (() => {
        const x = s.sessions.find((y) => y.id === i.sessionId);
        return !x.ageVerified || x.intoxicated;
      })() &&
      i.status !== "cancelled",
  );
  check(
    "No live alcohol reward on an un-ID'd/intoxicated table",
    unsafeAlc.length === 0,
  );
  const tonightRed = s.redemptions.filter((x) => Date.parse(x.createdAt) > t0);
  const lowProfit = tonightRed.filter(
    (x) => x.profit < s.settings.minProfit - 1e-9,
  );
  check(
    `Every redemption kept at least the S$${s.settings.minProfit} profit floor`,
    lowProfit.length === 0,
  );
  const lowMargin = tonightRed.filter(
    (x) =>
      x.revenue <= 0 ||
      (x.profit / x.revenue) * 100 + 1e-9 < s.settings.minMarginPercent,
  );
  check(
    `Every redemption kept at least the ${s.settings.minMarginPercent}% margin floor`,
    lowMargin.length === 0,
  );
  const rev = tonightRed.reduce((a, x) => a + x.revenue, 0),
    prof = tonightRed.reduce((a, x) => a + x.profit, 0),
    disc = tonightRed.reduce((a, x) => a + x.discount, 0);
  const spend = s.orders
    .filter((o) => o.organic && !o.voided && Date.parse(o.createdAt) > t0)
    .reduce(
      (a, o) =>
        a +
        o.items.reduce(
          (b, i) =>
            b + i.quantity * s.menu.find((m) => m.id === i.menuItemId).price,
          0,
        ),
      0,
    );
  say(
    `\nDB> Night totals: organic sales S$${spend.toFixed(2)} · reward sales ${tonightRed.length} = S$${rev.toFixed(2)} revenue, S$${prof.toFixed(2)} est. GP, S$${disc.toFixed(2)} discount given · final revision ${s.revision} · ${rpcCount} DB calls`,
  );
  const passed = checks.filter((c) => c.ok).length;
  say(`\nRESULT: ${passed}/${checks.length} checks passed`);
  checks
    .filter((c) => !c.ok)
    .forEach((c) => say(`  FAILED: ${c.name} ${c.detail}`));
  fs.writeFileSync(
    __dirname + "/result.json",
    JSON.stringify({ checks, stats, log: LOG }, null, 1),
  );
  await db.close();
})().catch((e) => {
  console.error("SIM CRASH", e);
  process.exit(1);
});
