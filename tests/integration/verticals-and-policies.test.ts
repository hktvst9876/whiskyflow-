/**
 * Flows beyond the restaurant happy path: bottle keep (bar), bucket remainder (beer pub),
 * service packages with a per-visit limit (spa), the randomised holdout, WhatsApp
 * STOP/BALANCE, POS ingestion idempotency, win-back once-only, campaign holdouts.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { listEntitlementsForCustomer, listPrograms } from "@/modules/anchors/repo";
import { listItems } from "@/modules/catalog/repo";
import { getCustomer } from "@/modules/customers/repo";
import { listRecipients } from "@/modules/campaigns/repo";
import { listMessages } from "@/modules/messaging/repo";
import { getDecisionForVisit } from "@/modules/offers/repo";
import type { Db } from "@/server/db";
import { launchCampaign } from "@/flows/campaigns";
import { claimByStaff, claimByToken } from "@/flows/claim-anchor";
import { closeVisit } from "@/flows/close-visit";
import { evaluateCheckoutOffer } from "@/flows/checkout-offer";
import type { FlowContext } from "@/flows/context";
import { handleInboundText } from "@/flows/inbound-message";
import { acceptOffer, keepStoredPurchase } from "@/flows/issue-anchor";
import { createMerchantFromPreset } from "@/flows/onboarding";
import { ingestPosOrder } from "@/flows/pos-ingest";
import { recordBottleLevel, redeemEntitlement } from "@/flows/redemption";
import { runSchedulerTick } from "@/flows/scheduler";
import { addItem, openVisit } from "@/flows/visits";
import { at, createTestDb, days, MONDAY_EVENING } from "../helpers/db";

const staff = { type: "staff" as const, id: null };

describe("bar: bottle keep", () => {
  let db: Db;
  let close: () => Promise<void>;
  let merchantId: string;
  const ctx = (now: Date): FlowContext => ({ merchantId, actor: staff, now });
  before(async () => {
    ({ db, close } = await createTestDb());
    merchantId = (await createMerchantFromPreset(db, { name: "The Copper Still", vertical: "bar", now: MONDAY_EVENING })).id;
  });
  after(() => close());

  it("keeps a bottle at a shelf, records levels, nudges when almost finished", async () => {
    const items = await listItems(db, merchantId);
    const macallan = items.find((i) => i.name === "Macallan 12")!;
    const keep = (await listPrograms(db, merchantId)).find((p) => p.issueMode === "stored_purchase")!;
    const visit = await openVisit(db, ctx(MONDAY_EVENING), { partySize: 4 });
    const line = await addItem(db, ctx(MONDAY_EVENING), visit.id, macallan.id, 1);
    const kept = await keepStoredPurchase(db, ctx(MONDAY_EVENING), { visitId: visit.id, lineId: line.id, programId: keep.id, quantity: 60, storageLocation: "Shelf B3" });
    assert.equal(kept.entitlement.unitType, "percent");
    assert.equal(kept.entitlement.unitRetailCents, macallan.priceCents, "valued at the bottle actually sold");
    assert.equal(kept.entitlement.pricePaidCents, 0, "already paid on the bill");
    await assert.rejects(
      keepStoredPurchase(db, ctx(MONDAY_EVENING), { visitId: visit.id, lineId: line.id, programId: keep.id, quantity: 50 }),
      /already being kept/,
    );
    await closeVisit(db, ctx(MONDAY_EVENING), visit.id);
    const claimed = await claimByStaff(db, ctx(at(MONDAY_EVENING, 60_000)), kept.entitlement.id, { phone: "+6591234567", name: "Ravi", serviceOptIn: true, marketingOptIn: true });

    const later = at(MONDAY_EVENING, days(9));
    const visit2 = await openVisit(db, ctx(later), { partySize: 3, customerId: claimed.customerId });
    const poured = await recordBottleLevel(db, ctx(later), { visitId: visit2.id, entitlementId: kept.entitlement.id, percent: 20 });
    assert.equal(poured.label, "Macallan 12 · 20% remaining");
    assert.equal(poured.lines[0]!.unitCostCents, 0, "stored purchases were expensed when sold");
    await assert.rejects(recordBottleLevel(db, ctx(later), { visitId: visit2.id, entitlementId: kept.entitlement.id, percent: 40 }), /cannot go up/);
    await addItem(db, ctx(later), visit2.id, items.find((i) => i.name === "Coke jug")!.id, 2);
    await closeVisit(db, ctx(later), visit2.id);

    await runSchedulerTick(db, at(later, days(1)));
    const msgs = await listMessages(db, merchantId, { customerId: claimed.customerId });
    const low = msgs.find((m) => m.templateKey === "bottle_low");
    assert.ok(low, "bottle-low nudge planned");
    assert.match(low.body, /almost finished \(20% left\)/);
  });
});

describe("beer pub: bucket remainder and the locker offer", () => {
  let db: Db;
  let close: () => Promise<void>;
  let merchantId: string;
  const ctx = (now: Date): FlowContext => ({ merchantId, actor: staff, now });
  before(async () => {
    ({ db, close } = await createTestDb());
    merchantId = (await createMerchantFromPreset(db, { name: "Hop & Barrel", vertical: "beer_pub", settings: { experiment: { holdoutRate: 0 } }, now: MONDAY_EVENING })).id;
  });
  after(() => close());

  it("values a kept bucket per beer, not per bucket", async () => {
    const items = await listItems(db, merchantId);
    const bucket = items.find((i) => i.category === "bucket")!;
    const program = (await listPrograms(db, merchantId)).find((p) => p.name === "Bucket remainder")!;
    const visit = await openVisit(db, ctx(MONDAY_EVENING), { partySize: 2 });
    const line = await addItem(db, ctx(MONDAY_EVENING), visit.id, bucket.id, 1);
    const kept = await keepStoredPurchase(db, ctx(MONDAY_EVENING), { visitId: visit.id, lineId: line.id, programId: program.id, quantity: 3 });
    assert.equal(kept.entitlement.unitRetailCents, bucket.priceCents / 5);
    assert.equal(kept.entitlement.quantityRemaining, 3);
  });

  it("offers the 2-pint locker on 4 beers + wings (brief §1)", async () => {
    const items = await listItems(db, merchantId);
    const lager = items.find((i) => i.name === "House Lager (pint)")!;
    const wings = items.find((i) => i.name === "Buffalo Wings")!;
    const visit = await openVisit(db, ctx(MONDAY_EVENING), { partySize: 2 });
    await addItem(db, ctx(MONDAY_EVENING), visit.id, lager.id, 4);
    await addItem(db, ctx(MONDAY_EVENING), visit.id, wings.id, 1);
    const offer = await evaluateCheckoutOffer(db, ctx(MONDAY_EVENING), visit.id);
    assert.equal(offer?.decision.outcome, "offered", offer?.reason);
    assert.match(offer!.candidate!.pitch.staff, /2 Pints Remaining/);
  });
});

describe("spa: one session per visit", () => {
  let db: Db;
  let close: () => Promise<void>;
  let merchantId: string;
  const ctx = (now: Date): FlowContext => ({ merchantId, actor: staff, now });
  before(async () => {
    ({ db, close } = await createTestDb());
    merchantId = (await createMerchantFromPreset(db, { name: "Serenity Spa", vertical: "spa", now: MONDAY_EVENING })).id;
  });
  after(() => close());

  it("keeps 2 of a 3-massage package and allows one per visit", async () => {
    const items = await listItems(db, merchantId);
    const pack = items.find((i) => i.category === "package")!;
    const program = (await listPrograms(db, merchantId)).find((p) => p.name === "Massage package")!;
    const visit = await openVisit(db, ctx(MONDAY_EVENING), { partySize: 1 });
    const line = await addItem(db, ctx(MONDAY_EVENING), visit.id, pack.id, 1);
    const kept = await keepStoredPurchase(db, ctx(MONDAY_EVENING), { visitId: visit.id, lineId: line.id, programId: program.id, quantity: 2 });
    assert.equal(kept.entitlement.unitRetailCents, 11000, "$330 package / 3 sessions");
    await closeVisit(db, ctx(MONDAY_EVENING), visit.id);
    const claimed = await claimByStaff(db, ctx(MONDAY_EVENING), kept.entitlement.id, { phone: "+6590001111", serviceOptIn: true, marketingOptIn: false });
    const later = at(MONDAY_EVENING, days(14));
    const visit2 = await openVisit(db, ctx(later), { partySize: 1, customerId: claimed.customerId });
    await assert.rejects(redeemEntitlement(db, ctx(later), { visitId: visit2.id, entitlementId: kept.entitlement.id, quantity: 2 }), /Up to 1 per visit/);
    const used = await redeemEntitlement(db, ctx(later), { visitId: visit2.id, entitlementId: kept.entitlement.id, quantity: 1 });
    assert.equal(used.label, "1 Massage Waiting");
  });
});

describe("holdout, guardrails and messaging policy", () => {
  let db: Db;
  let close: () => Promise<void>;
  let merchantId: string;
  const ctx = (now: Date): FlowContext => ({ merchantId, actor: staff, now });
  before(async () => {
    ({ db, close } = await createTestDb());
    merchantId = (await createMerchantFromPreset(db, { name: "ABC Kitchen", vertical: "restaurant", settings: { experiment: { holdoutRate: 0.5 } }, now: MONDAY_EVENING })).id;
  });
  after(() => close());

  async function billWithTwoMains(now: Date, customerId: string | null = null) {
    const items = await listItems(db, merchantId);
    const visit = await openVisit(db, ctx(now), { partySize: 2, customerId });
    await addItem(db, ctx(now), visit.id, items.find((i) => i.name === "Roast Chicken")!.id, 2);
    await addItem(db, ctx(now), visit.id, items.find((i) => i.name === "Truffle Fries")!.id, 2);
    return visit;
  }

  it("holds out part of the eligible bills with no offer shown", async () => {
    const outcomes = new Map<string, number>();
    for (let i = 0; i < 24; i++) {
      const visit = await billWithTwoMains(at(MONDAY_EVENING, i * 60_000));
      const offer = await evaluateCheckoutOffer(db, ctx(at(MONDAY_EVENING, i * 60_000)), visit.id);
      outcomes.set(offer!.decision.outcome, (outcomes.get(offer!.decision.outcome) ?? 0) + 1);
      if (offer!.decision.outcome === "holdout") {
        assert.equal(offer!.exposure, null, "the holdout never sees an offer");
        assert.match(offer!.reason, /Holdout/);
      }
      const decision = await getDecisionForVisit(db, visit.id);
      assert.ok(decision?.experimentId);
    }
    assert.ok((outcomes.get("holdout") ?? 0) > 0 && (outcomes.get("offered") ?? 0) > 0, JSON.stringify([...outcomes]));
  });

  it("STOP stops all messages, keeps the balance, and BALANCE replies with what they own", async () => {
    // Find an offered bill and claim the anchor.
    let claimedCustomer: string | null = null;
    for (let i = 0; i < 20 && !claimedCustomer; i++) {
      const now = at(MONDAY_EVENING, days(1) + i * 60_000);
      const visit = await billWithTwoMains(now);
      const offer = await evaluateCheckoutOffer(db, ctx(now), visit.id);
      if (offer?.exposure) {
        const issued = await acceptOffer(db, ctx(now), offer.exposure.id);
        await closeVisit(db, ctx(now), visit.id);
        claimedCustomer = (await claimByToken(db, issued.claimToken!, { phone: "+6582223333", serviceOptIn: true, marketingOptIn: true, clientKey: "t", now })).customerId;
      }
    }
    assert.ok(claimedCustomer);
    const now = at(MONDAY_EVENING, days(2));
    const balance = await handleInboundText(db, { fromPhone: "6582223333", text: "balance?", providerMessageId: "wamid.1", now, merchantId });
    assert.equal(balance.intent, "balance");
    let msgs = await listMessages(db, merchantId, { customerId: claimedCustomer });
    assert.match(msgs.find((m) => m.templateKey === "balance_reply")!.body, /1 Main Waiting/);
    // Duplicate webhook deliveries are ignored.
    assert.equal((await handleInboundText(db, { fromPhone: "6582223333", text: "balance?", providerMessageId: "wamid.1", now, merchantId })).replies, 0);

    await handleInboundText(db, { fromPhone: "+6582223333", text: "STOP", providerMessageId: "wamid.2", now, merchantId });
    const customer = await getCustomer(db, merchantId, claimedCustomer);
    assert.equal(customer.whatsappMarketingOptIn, false);
    assert.equal(customer.whatsappServiceOptIn, false);
    assert.equal((await listEntitlementsForCustomer(db, claimedCustomer, ["active"])).length, 1, "what they own is untouched");
    const due = (await listMessages(db, merchantId, { customerId: claimedCustomer })).find((m) => m.templateKey === "anchor_reminder")!;
    await runSchedulerTick(db, at(due.scheduledFor, 60_000));
    msgs = await listMessages(db, merchantId, { customerId: claimedCustomer });
    const reminder = msgs.find((m) => m.templateKey === "anchor_reminder")!;
    assert.equal(reminder.status, "suppressed");
    assert.match(reminder.suppressReason ?? "", /consent/i);
  });

  it("sends a win-back once per anchor, never escalating", async () => {
    let customerId: string | null = null;
    for (let i = 0; i < 20 && !customerId; i++) {
      const now = at(MONDAY_EVENING, days(3) + i * 60_000);
      const visit = await billWithTwoMains(now);
      const offer = await evaluateCheckoutOffer(db, ctx(now), visit.id);
      if (offer?.exposure) {
        const issued = await acceptOffer(db, ctx(now), offer.exposure.id);
        await closeVisit(db, ctx(now), visit.id);
        customerId = (await claimByToken(db, issued.claimToken!, { phone: "+6584445555", serviceOptIn: true, marketingOptIn: true, clientKey: "t2", now })).customerId;
      }
    }
    assert.ok(customerId);
    for (const d of [31, 32, 45, 55]) await runSchedulerTick(db, at(MONDAY_EVENING, days(3 + d)));
    const winBacks = (await listMessages(db, merchantId, { customerId })).filter((m) => m.templateKey === "anchor_win_back");
    assert.equal(winBacks.length, 1);
    assert.equal(winBacks[0]!.status, "delivered", winBacks[0]!.suppressReason ?? "");
    assert.match(winBacks[0]!.body, /still waiting/);
    assert.doesNotMatch(winBacks[0]!.body, /% off/, "win-backs are perks, not discounts");
  });

  it("launches a campaign with a holdout and only messages the treatment arm", async () => {
    const campaignAt = at(MONDAY_EVENING, days(70));
    await runSchedulerTick(db, campaignAt); // rescore → segments
    const campaign = await launchCampaign(db, ctx(campaignAt), "win_back").catch((e: Error) => e);
    if (campaign instanceof Error) {
      assert.match(campaign.message, /Nobody fits/);
      return;
    }
    const recipients = await listRecipients(db, campaign.id);
    assert.ok(recipients.length > 0);
    for (const r of recipients) assert.equal(r.arm === "holdout", r.messageId === null);
  });
});

describe("POS ingestion", () => {
  let db: Db;
  let close: () => Promise<void>;
  let merchantId: string;
  before(async () => {
    ({ db, close } = await createTestDb());
    merchantId = (await createMerchantFromPreset(db, { name: "ABC Kitchen", vertical: "restaurant", settings: { experiment: { holdoutRate: 0 } }, now: MONDAY_EVENING })).id;
  });
  after(() => close());

  it("upserts a bill by externalRef and returns the staff offer", async () => {
    const ctx: FlowContext = { merchantId, actor: { type: "api", id: null }, now: MONDAY_EVENING };
    const order = {
      externalRef: "POS-1001",
      status: "open" as const,
      partySize: 2,
      lines: [
        { name: "Roast Chicken", quantity: 2, unitPriceCents: 2200 },
        { name: "Truffle Fries", quantity: 2, unitPriceCents: 900 },
      ],
      evaluateOffer: true,
    };
    const first = await ingestPosOrder(db, ctx, order);
    assert.equal(first.created, true);
    assert.equal(first.offer?.outcome, "offered");
    assert.match(first.offer!.staffText!, /1 Main Waiting/);
    const again = await ingestPosOrder(db, ctx, { ...order, lines: [...order.lines, { name: "Craft Soda", quantity: 1, unitPriceCents: 700 }] });
    assert.equal(again.visitId, first.visitId);
    assert.equal(again.created, false);
    assert.equal(again.offer?.exposureId, first.offer?.exposureId, "no re-roll on update");
    const closed = await ingestPosOrder(db, ctx, { ...order, status: "closed" });
    assert.equal(closed.status, "closed");
  });
});
