import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSettings } from "../merchants/settings";
import type { ExposureFact } from "../offers/types";
import { evaluateGuardrails } from "./evaluate";
import type { GuardrailInput } from "./types";

const settings = parseSettings({});
const now = new Date("2026-10-12T10:00:00Z"); // 18:00 in Singapore
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

const goodDeal = {
  deltaECents: 900,
  todayMarginRate: 0.6,
  depth: 0.6,
  coveredRetailCents: 2400,
  expectedNextVisitSpendCents: 5800,
};

function checkout(overrides: Partial<GuardrailInput> = {}): GuardrailInput {
  return {
    now,
    kind: "checkout_offer",
    offer: { offerType: "anchor_upgrade", isDiscount: false, promoCostCents: 0, isWinBack: false, deal: goodDeal },
    customer: { identified: true, segment: "persuadable", activeAnchorCount: 0 },
    history: [],
    visit: { hasOtherPromo: false },
    merchant: { outstandingLiabilityCents: 0, addedLiabilityCents: 2400, blackoutReason: null },
    ...overrides,
  };
}

function exposure(overrides: Partial<ExposureFact> = {}): ExposureFact {
  return { offerType: "win_back_perk", isDiscount: false, status: "shown", channel: "whatsapp", promoCostCents: 300, shownAt: daysAgo(5), ...overrides };
}

describe("evaluateGuardrails — checkout offers", () => {
  it("allows a healthy paid anchor upgrade", () => {
    const result = evaluateGuardrails(checkout(), settings);
    assert.equal(result.allowed, true, JSON.stringify(result.blockedBy));
  });

  it("blocks stacking on a bill that already has a promotion (critical)", () => {
    const result = evaluateGuardrails(checkout({ visit: { hasOtherPromo: true } }), settings);
    assert.equal(result.allowed, false);
    assert.equal(result.blockedBy[0]!.key, "no-stacking");
  });

  it("re-checks economics as a safety net", () => {
    const result = evaluateGuardrails(checkout({ offer: { offerType: "anchor_upgrade", isDiscount: false, promoCostCents: 0, isWinBack: false, deal: { ...goodDeal, deltaECents: 100, todayMarginRate: 0.2 } } }), settings);
    assert.deepEqual(result.blockedBy.map((r) => r.key).sort(), ["min-contribution", "min-today-margin"]);
  });

  it("caps open anchors per customer and total liability", () => {
    const result = evaluateGuardrails(
      checkout({
        customer: { identified: true, segment: "new", activeAnchorCount: 2 },
        merchant: { outstandingLiabilityCents: settings.guardrails.liabilityCapCents, addedLiabilityCents: 1, blackoutReason: null },
      }),
      settings,
    );
    assert.deepEqual(result.blockedBy.map((r) => r.key).sort(), ["liability-cap", "max-active-anchors"]);
  });

  it("honours blackout dates", () => {
    const result = evaluateGuardrails(checkout({ merchant: { outstandingLiabilityCents: 0, addedLiabilityCents: 0, blackoutReason: "Christmas Eve" } }), settings);
    assert.equal(result.blockedBy[0]?.key, "blackout-period");
  });

  it("lets merchants disable non-critical rules but never critical ones", () => {
    const relaxed = parseSettings({ guardrails: { disabledRules: ["blackout-period", "no-stacking"] } });
    const result = evaluateGuardrails(
      checkout({ visit: { hasOtherPromo: true }, merchant: { outstandingLiabilityCents: 0, addedLiabilityCents: 0, blackoutReason: "Peak" } }),
      relaxed,
    );
    assert.deepEqual(result.blockedBy.map((r) => r.key), ["no-stacking"]);
  });
});

describe("evaluateGuardrails — promotional message offers", () => {
  const winBack = (overrides: Partial<GuardrailInput> = {}): GuardrailInput => ({
    now,
    kind: "message_offer",
    offer: { offerType: "win_back_perk", isDiscount: false, promoCostCents: 300, isWinBack: true },
    customer: { identified: true, segment: "at_risk", activeAnchorCount: 1 },
    history: [],
    ...overrides,
  });

  it("allows a first, non-discount win-back perk", () => {
    assert.equal(evaluateGuardrails(winBack(), settings).allowed, true);
  });

  it("never escalates: a win-back worth more than the last promotion is blocked", () => {
    const result = evaluateGuardrails(
      winBack({
        offer: { offerType: "win_back_perk", isDiscount: false, promoCostCents: 900, isWinBack: true },
        history: [exposure({ offerType: "off_peak_perk", status: "expired", promoCostCents: 300, shownAt: daysAgo(40) })],
      }),
      settings,
    );
    assert.ok(result.blockedBy.some((r) => r.key === "no-inactivity-escalation"));
  });

  it("never uses discounts for win-backs", () => {
    const result = evaluateGuardrails(winBack({ offer: { offerType: "win_back_perk", isDiscount: true, promoCostCents: 100, isWinBack: true } }), settings);
    assert.ok(result.blockedBy.some((r) => r.key === "no-inactivity-escalation"));
  });

  it("limits win-backs per window and enforces the cooldown", () => {
    const result = evaluateGuardrails(winBack({ history: [exposure({ status: "expired", shownAt: daysAgo(10) })] }), settings);
    const keys = result.blockedBy.map((r) => r.key);
    assert.ok(keys.includes("win-back-limit"));
    assert.ok(keys.includes("cooldown-after-offer"));
  });

  it("keeps discounts away from likely regulars", () => {
    const result = evaluateGuardrails(
      {
        now,
        kind: "message_offer",
        offer: { offerType: "bring_a_friend", isDiscount: true, promoCostCents: 330, isWinBack: false },
        customer: { identified: true, segment: "likely_regular", activeAnchorCount: 0 },
        history: [],
      },
      settings,
    );
    assert.ok(result.blockedBy.some((r) => r.key === "regulars-no-discount"));
  });
});

describe("evaluateGuardrails — message dispatch", () => {
  const recipient = {
    status: "active" as const,
    phoneE164: "+6581234567",
    whatsappServiceOptIn: true,
    whatsappMarketingOptIn: false,
    optedOutAt: null,
    lastVisitAt: daysAgo(10),
    marketingSent7: 0,
    marketingSent30: 0,
  };

  it("requires marketing consent for marketing messages", () => {
    const result = evaluateGuardrails(
      { now, kind: "message", message: { templateKey: "anchor_reminder", category: "marketing", isReminder: true, entitlementActive: true, timeZone: "Asia/Singapore", recipient } },
      settings,
    );
    assert.equal(result.allowed, false);
    assert.equal(result.blockedBy[0]!.key, "consent-required");
    assert.equal(result.deferUntil, null);
  });

  it("defers (not drops) messages during quiet hours", () => {
    const night = new Date("2026-10-12T15:30:00Z"); // 23:30 SGT
    const result = evaluateGuardrails(
      { now: night, kind: "message", message: { templateKey: "anchor_expiry_warning", category: "utility", isReminder: true, entitlementActive: true, timeZone: "Asia/Singapore", recipient } },
      settings,
    );
    assert.equal(result.allowed, false);
    assert.equal(result.deferUntil?.toISOString(), "2026-10-13T01:00:00.000Z"); // 09:00 SGT next day
  });

  it("sends the claim confirmation immediately even at night (the guest just claimed it)", () => {
    const night = new Date("2026-10-12T15:30:00Z"); // 23:30 SGT, a bar guest at the counter
    const result = evaluateGuardrails(
      { now: night, kind: "message", message: { templateKey: "anchor_confirmation", category: "utility", isReminder: false, entitlementActive: true, timeZone: "Asia/Singapore", recipient } },
      settings,
    );
    assert.equal(result.allowed, true);
  });

  it("drops reminders about anchors that are no longer active", () => {
    const result = evaluateGuardrails(
      { now, kind: "message", message: { templateKey: "anchor_reminder", category: "utility", isReminder: true, entitlementActive: false, timeZone: "Asia/Singapore", recipient } },
      settings,
    );
    assert.ok(result.blockedBy.some((r) => r.key === "entitlement-still-active"));
  });

  it("skips reminders when the customer was just here", () => {
    const result = evaluateGuardrails(
      { now, kind: "message", message: { templateKey: "anchor_reminder", category: "utility", isReminder: true, entitlementActive: true, timeZone: "Asia/Singapore", recipient: { ...recipient, lastVisitAt: daysAgo(1) } } },
      settings,
    );
    assert.ok(result.blockedBy.some((r) => r.key === "recently-visited"));
  });
});
