import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../lib/seed";
import {
  evaluate,
  redeem,
  invalidateActiveRewards,
  incrementalProfit,
} from "../lib/engine";
const now = Date.now();
function fixture() {
  const s = seed(now),
    session = s.sessions[3];
  s.orders = s.orders.filter((o) => o.organic);
  s.instances = [];
  s.redemptions = [];
  s.history = [];
  s.decisions = [];
  s.sessions.forEach((x) => {
    x.offerReceived = false;
    x.control = false;
  });
  s.settings.minScore = 0;
  s.settings.allocationProbability = 0.95;
  return { s, session };
}
const guaranteed = { now, random: () => 0 };
test("no reward before an organic order, with a logged reason", () => {
  const { s, session } = fixture();
  s.orders = [];
  const d = evaluate(s, session.id, guaranteed);
  assert.equal(d.outcome, "withheld");
  assert.ok(d.reasons.includes("No qualifying organic order"));
  assert.equal(s.decisions.length, 1);
});
test("beer basket receives an incremental snack, not more beer", () => {
  const { s, session } = fixture();
  const d = evaluate(s, session.id, guaranteed);
  assert.equal(d.outcome, "shown");
  assert.equal(s.offers.find((o) => o.id === d.offerId)?.kind, "snack_addon");
});
test("AI advisor can choose only an eligible offer and NO_OFFER consumes the visit opportunity", () => {
  const selected = fixture();
  const offerId = selected.s.offers.find((o) => o.kind === "snack_addon")!.id;
  const shown = evaluate(selected.s, selected.session.id, {
    ...guaranteed,
    recommendation: { offerId, rationale: "Relevant profitable add-on" },
  });
  assert.equal(shown.outcome, "shown");
  assert.equal(shown.offerId, offerId);
  assert.equal(shown.selectionSource, "ai");
  assert.equal(shown.advisorRationale, "Relevant profitable add-on");

  const noOffer = fixture();
  const withheld = evaluate(noOffer.s, noOffer.session.id, {
    ...guaranteed,
    recommendation: { offerId: null, rationale: "Likely cannibalisation" },
  });
  assert.equal(withheld.outcome, "withheld");
  assert.equal(withheld.selectionSource, "ai");
  assert.ok(noOffer.session.rewardAttemptedAt);
  assert.ok(
    evaluate(noOffer.s, noOffer.session.id, guaranteed).reasons.some((reason) =>
      reason.includes("opportunity"),
    ),
  );

  const invented = fixture();
  const rejected = evaluate(invented.s, invented.session.id, {
    ...guaranteed,
    recommendation: {
      offerId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      rationale: "Invented choice",
    },
  });
  assert.equal(rejected.outcome, "withheld");
  assert.match(rejected.reasons[0], /did not pass/);
  assert.equal(invented.s.instances.length, 0);
});
test("only one reward in a visit, even after cancellation", () => {
  const { s, session } = fixture();
  evaluate(s, session.id, guaranteed);
  s.instances[0].status = "cancelled";
  const d = evaluate(s, session.id, guaranteed);
  assert.equal(d.outcome, "withheld");
  assert.ok(d.reasons[0].includes("already allocated"));
});
test("discounted bills cannot stack", () => {
  const { s, session } = fixture();
  s.orders.find((o) => o.sessionId === session.id)!.discount = true;
  assert.equal(evaluate(s, session.id, guaranteed).outcome, "withheld");
});
test("customer subsidised reward frequency cap applies for 30 days", () => {
  const { s, session } = fixture();
  session.customerId = s.customers[0].id;
  s.history = [
    {
      customerId: session.customerId,
      offerId: s.offers[0].id,
      createdAt: new Date(now - 86400000).toISOString(),
      redeemedAt: new Date(now - 86400000).toISOString(),
    },
  ];
  assert.ok(
    evaluate(s, session.id, guaranteed).reasons.some((r) =>
      r.includes("30-day"),
    ),
  );
});
test("same promotion cannot repeat within 60 days", () => {
  const { s, session } = fixture();
  session.customerId = s.customers[0].id;
  s.history = [
    {
      customerId: session.customerId,
      offerId: s.offers[1].id,
      createdAt: new Date(now - 40 * 86400000).toISOString(),
      redeemedAt: new Date(now - 40 * 86400000).toISOString(),
    },
  ];
  assert.ok(
    evaluate(s, session.id, guaranteed).reasons.some((r) =>
      r.includes("60 days"),
    ),
  );
});
test("profit floor is strict and inventory must cover the purchase", () => {
  const { s, session } = fixture();
  const offer = s.offers[1],
    item = s.menu.find((m) => m.id === offer.itemId)!;
  s.settings.minProfit = offer.price - item.cost;
  assert.equal(evaluate(s, session.id, guaranteed).outcome, "withheld");
  s.settings.minProfit = 0;
  item.stock = 0;
  assert.equal(evaluate(s, session.id, guaranteed).outcome, "withheld");
});
test("percentage margin floor is enforced independently of cash profit", () => {
  const rejected = fixture();
  rejected.s.settings.minProfit = 0;
  rejected.s.settings.minMarginPercent = 70;
  const withheld = evaluate(rejected.s, rejected.session.id, guaranteed);
  assert.equal(withheld.outcome, "withheld");
  assert.ok(withheld.reasons.some((reason) => reason.includes("margin floor")));

  const accepted = fixture();
  accepted.s.settings.minProfit = 0;
  accepted.s.settings.minMarginPercent = 69;
  assert.equal(
    evaluate(accepted.s, accepted.session.id, guaranteed).outcome,
    "shown",
  );
});
test("daily allocation counts cancelled and expired instances", () => {
  const { s, session } = fixture();
  s.offers[1].dailyCap = 1;
  evaluate(s, session.id, guaranteed);
  s.instances[0].status = "cancelled";
  const other = s.sessions[0];
  s.orders.find((o) => o.sessionId === other.id)!.items = s.orders.find(
    (o) => o.sessionId === session.id,
  )!.items;
  assert.ok(
    evaluate(s, other.id, guaranteed).reasons.some((r) =>
      r.includes("daily allocation"),
    ),
  );
});
test("alcohol reward is withheld for unverified or intoxicated guests", () => {
  for (const intoxicated of [false, true]) {
    const { s } = fixture(),
      session = s.sessions[2];
    session.ageVerified = intoxicated;
    session.intoxicated = intoxicated;
    s.offers = s.offers.filter((o) => o.kind === "bottle_tradeup");
    assert.ok(
      evaluate(s, session.id, guaranteed).reasons.some((r) =>
        r.includes("alcohol safety"),
      ),
    );
  }
});
test("already purchased target items are never discounted", () => {
  const { s, session } = fixture();
  s.orders
    .find((o) => o.sessionId === session.id)!
    .items.push({ menuItemId: s.offers[1].itemId, quantity: 1 });
  assert.equal(evaluate(s, session.id, guaranteed).outcome, "withheld");
});
test("random allocation and control cohort can withhold eligible rewards", () => {
  const { s, session } = fixture();
  assert.equal(
    evaluate(s, session.id, { now, random: () => 0.999 }).outcome,
    "withheld",
  );
  const control = fixture();
  control.session.control = true;
  assert.equal(
    evaluate(control.s, control.session.id, guaranteed).outcome,
    "control",
  );
});
test("a withheld allocation cannot be rerolled by another order or staff override", () => {
  const { s, session } = fixture();
  evaluate(s, session.id, { now, random: () => 0.999 });
  assert.ok(session.rewardAttemptedAt);
  const again = evaluate(s, session.id, {
    ...guaranteed,
    preferredOfferId: s.offers[1].id,
  });
  assert.equal(again.outcome, "withheld");
  assert.ok(again.reasons.some((r) => r.includes("opportunity")));
  assert.equal(s.instances.length, 0);
});
test("one customer's active reward reserves eligibility at other tables", () => {
  const { s, session } = fixture();
  session.customerId = s.customers[0].id;
  evaluate(s, session.id, guaranteed);
  const other = s.sessions[0];
  other.customerId = session.customerId;
  const result = evaluate(s, other.id, guaranteed);
  assert.equal(result.outcome, "withheld");
  assert.ok(result.reasons.some((r) => r.includes("another table")));
});
test("redemption is table-bound, single-use and audited", () => {
  const { s, session } = fixture();
  evaluate(s, session.id, guaranteed);
  const i = s.instances[0];
  assert.equal(redeem(s, s.sessions[0].id, i.code, "Staff", now).ok, false);
  assert.equal(redeem(s, session.id, i.code, "Staff", now).ok, true);
  assert.equal(redeem(s, session.id, i.code, "Staff", now).ok, false);
  assert.equal(s.redemptions.length, 1);
  assert.equal(
    s.audits.filter((a) => a.action === "Redemption rejected").length,
    2,
  );
  assert.equal(s.orders.at(-1)!.organic, false);
});
test("expiry and removed qualifying orders prevent redemption", () => {
  const { s, session } = fixture();
  evaluate(s, session.id, guaranteed);
  const i = s.instances[0];
  assert.equal(
    redeem(s, session.id, i.code, "Staff", now + 13 * 60000).ok,
    false,
  );
  s.orders.find((o) => o.id === i.qualifyingOrderIds[0])!.voided = true;
  assert.ok(
    redeem(s, session.id, i.code, "Staff", now).reasons.some((r) =>
      r.includes("no longer"),
    ),
  );
});
test("staff block cannot be bypassed through an override", () => {
  const { s, session } = fixture();
  session.blocked = true;
  assert.equal(
    evaluate(s, session.id, { ...guaranteed, preferredOfferId: s.offers[1].id })
      .outcome,
    "withheld",
  );
});
test("live policy withholds subsidised rewards for an unknown customer", () => {
  const { s, session } = fixture();
  assert.equal(
    evaluate(s, session.id, { ...guaranteed, requireIdentity: true }).outcome,
    "withheld",
  );
  session.customerId = s.customers[0].id;
  session.customerVerified = true;
  assert.equal(
    evaluate(s, session.id, { ...guaranteed, requireIdentity: true }).outcome,
    "shown",
  );
});

test("stock or margin changes cancel a pending reward without resetting the visit", () => {
  const { s, session } = fixture();
  evaluate(s, session.id, guaranteed);
  s.menu.find((m) => m.id === s.offers[1].itemId)!.stock = 0;
  invalidateActiveRewards(s, "Inventory manager");
  assert.equal(s.instances[0].status, "cancelled");
  assert.equal(session.offerReceived, true);
  assert.equal(incrementalProfit(5.4, 2.5, 1), 2.9);
});
