/**
 * The MVP retention loop end to end (brief §17, steps 1-18) against a real Postgres
 * (PGlite): menu → basket → offer → accept → QR claim → WhatsApp confirmation → timed
 * reminder → return visit → redemption → upsell → incremental revenue → next anchor.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { listItems } from "@/modules/catalog/repo";
import { getCustomer } from "@/modules/customers/repo";
import { attributionForPeriod } from "@/modules/analytics/queries";
import { getEntitlement } from "@/modules/anchors/repo";
import { listMessages } from "@/modules/messaging/repo";
import { getExposure } from "@/modules/offers/repo";
import type { Db } from "@/server/db";
import { acceptOffer } from "@/flows/issue-anchor";
import { claimByToken, getClaimView } from "@/flows/claim-anchor";
import { closeVisit } from "@/flows/close-visit";
import { evaluateCheckoutOffer } from "@/flows/checkout-offer";
import type { FlowContext } from "@/flows/context";
import { createMerchantFromPreset } from "@/flows/onboarding";
import { addUpsell, getUpsellForVisit, redeemEntitlement } from "@/flows/redemption";
import { runSchedulerTick } from "@/flows/scheduler";
import { addItem, attachCustomer, findCustomer, openVisit, visitView } from "@/flows/visits";
import { at, createTestDb, days, MONDAY_EVENING } from "../helpers/db";

describe("restaurant retention loop", () => {
  let db: Db;
  let close: () => Promise<void>;
  let merchantId: string;
  const staff = { type: "staff" as const, id: null };
  const ctx = (now: Date): FlowContext => ({ merchantId, actor: staff, now });

  before(async () => {
    ({ db, close } = await createTestDb());
    // No holdout here so the offer is deterministic; the holdout has its own test.
    const merchant = await createMerchantFromPreset(db, {
      name: "ABC Kitchen",
      vertical: "restaurant",
      settings: { experiment: { holdoutRate: 0 } },
      now: MONDAY_EVENING,
    });
    merchantId = merchant.id;
  });
  after(() => close());

  it("runs the whole loop and reports incremental revenue", async () => {
    // 1-2. Menu exists; the customer orders 2 mains + 2 sides.
    const items = await listItems(db, merchantId);
    const byName = (n: string) => items.find((i) => i.name === n)!;
    const visit = await openVisit(db, ctx(MONDAY_EVENING), { partySize: 2, label: "T4" });
    await addItem(db, ctx(MONDAY_EVENING), visit.id, byName("Roast Chicken").id, 1);
    await addItem(db, ctx(MONDAY_EVENING), visit.id, byName("Prawn Linguine").id, 1);
    await addItem(db, ctx(MONDAY_EVENING), visit.id, byName("Truffle Fries").id, 1);
    await addItem(db, ctx(MONDAY_EVENING), visit.id, byName("Garden Salad").id, 1);

    // 3-5. Basket analysed; staff see "Offer +$X → 1 Main Waiting".
    const offer = await evaluateCheckoutOffer(db, ctx(MONDAY_EVENING), visit.id);
    assert.ok(offer, "an offer view is returned");
    assert.equal(offer.decision.outcome, "offered", offer.reason);
    assert.ok(offer.exposure);
    assert.match(offer.candidate!.pitch.staff, /^Offer \+\$\d+ → 1 Main Waiting$/);
    assert.ok(offer.candidate!.deltaECents >= 300, "clears the minimum expected contribution");
    // Re-evaluating never re-rolls the offer.
    const again = await evaluateCheckoutOffer(db, ctx(MONDAY_EVENING), visit.id);
    assert.equal(again!.decision.id, offer.decision.id);

    // 6-7. Customer accepts; anchor waits for the QR claim.
    const issued = await acceptOffer(db, ctx(MONDAY_EVENING), offer.exposure!.id);
    assert.equal(issued.entitlement.status, "pending_claim");
    assert.ok(issued.claimToken && issued.claimUrl);
    const view = await visitView(db, ctx(MONDAY_EVENING), visit.id);
    assert.equal(view.totals.anchorUpgradeRevenueCents, offer.candidate!.priceCents);
    assert.equal(view.pendingClaims.length, 1);
    const summary1 = await closeVisit(db, ctx(MONDAY_EVENING), visit.id);
    assert.match(summary1.headline, /New Return Anchor sold/);

    // 8-9. QR scan → claim page → wallet + WhatsApp confirmation "You have 1 Main Waiting".
    const claimPage = await getClaimView(db, issued.claimToken!, at(MONDAY_EVENING, 60_000));
    assert.equal(claimPage!.label, "1 Main Waiting");
    assert.ok(claimPage!.terms.some((t) => t.label === "Refunds"));
    const claimed = await claimByToken(db, issued.claimToken!, {
      phone: "8123 4567",
      name: "Mei",
      serviceOptIn: true,
      marketingOptIn: true,
      clientKey: "test",
      now: at(MONDAY_EVENING, 120_000),
    });
    assert.match(claimed.walletUrl, /\/w\//);
    const afterClaim = await listMessages(db, merchantId, { customerId: claimed.customerId });
    const confirmation = afterClaim.find((m) => m.templateKey === "anchor_confirmation")!;
    assert.equal(confirmation.status, "delivered");
    assert.match(confirmation.body, /You have 1 Main Waiting at ABC Kitchen/);
    const reminder = afterClaim.find((m) => m.templateKey === "anchor_reminder")!;
    assert.equal(reminder.status, "scheduled");
    assert.ok(reminder.scheduledFor.getTime() > MONDAY_EVENING.getTime() + days(3));
    // The claim link stops working once used.
    assert.equal(await getClaimView(db, issued.claimToken!, at(MONDAY_EVENING, 180_000)), null);

    // 10-11. The scheduler sends the personalised reminder when it is due.
    const tick = await runSchedulerTick(db, at(reminder.scheduledFor, 60_000));
    assert.ok(tick.messages.sent >= 1);
    const sentReminder = (await listMessages(db, merchantId, { customerId: claimed.customerId })).find((m) => m.templateKey === "anchor_reminder")!;
    assert.equal(sentReminder.status, "delivered");
    assert.match(sentReminder.body, /You still have 1 Main Waiting at ABC Kitchen/);

    // 12-14. Customer walks in with a friend; staff scan the wallet code and redeem.
    const back = at(reminder.scheduledFor, days(2));
    const visit2 = await openVisit(db, ctx(back), { partySize: 2 });
    const { redeemCode } = await getCustomer(db, merchantId, claimed.customerId);
    const customer = await findCustomer(db, ctx(back), `${redeemCode.slice(0, 4)}-${redeemCode.slice(4)}`);
    assert.ok(customer);
    await attachCustomer(db, ctx(back), visit2.id, customer.id);
    const view2 = await visitView(db, ctx(back), visit2.id);
    assert.equal(view2.anchors.length, 1);
    assert.equal(view2.anchors[0]!.label, "1 Main Waiting");
    assert.ok(view2.anchors[0]!.redeemable);
    await redeemEntitlement(db, ctx(back), { visitId: visit2.id, entitlementId: issued.entitlement.id, itemId: byName("Mushroom Risotto").id });
    const used = await getEntitlement(db, merchantId, issued.entitlement.id);
    assert.equal(used.status, "fully_redeemed");

    // 15-16. Add-on recommendations; the friend's main and drinks are new cash.
    const upsell = await getUpsellForVisit(db, ctx(back), visit2.id);
    assert.ok(upsell.length > 0);
    assert.ok(upsell.some((u) => u.category === "main" || u.category === "drink"));
    await addUpsell(db, ctx(back), { visitId: visit2.id, itemId: byName("Wagyu Burger").id });
    await addItem(db, ctx(back), visit2.id, byName("Craft Soda").id, 2);

    // 17. Incremental revenue of the redemption visit.
    const summary2 = await closeVisit(db, ctx(back), visit2.id);
    assert.ok(summary2.totals.isRedemptionVisit);
    assert.equal(summary2.totals.newCashRevenueCents, 2300 + 2 * 700);
    assert.match(summary2.headline, /Redemption visit/);
    const report = await attributionForPeriod(db, merchantId, at(MONDAY_EVENING, -days(1)), at(back, days(1)));
    assert.equal(report.redemptions, 1);
    assert.equal(report.customersReturning, 1);
    assert.equal(report.newCashDuringRedemptionsCents, 3700);
    assert.equal(report.storedValueRedeemedCents, 2400);
    assert.equal(report.newPackagesSoldCents, offer.candidate!.priceCents);

    // A used-up anchor cancels its pending messages (no expiry warning for nothing).
    const remaining = (await listMessages(db, merchantId, { customerId: claimed.customerId })).filter((m) => m.status === "scheduled" && m.entitlementId === issued.entitlement.id);
    assert.equal(remaining.length, 0);
    const exposure = await getExposure(db, merchantId, offer.exposure!.id);
    assert.equal(exposure.status, "accepted");
    assert.equal(exposure.customerId, claimed.customerId);
  });
});
