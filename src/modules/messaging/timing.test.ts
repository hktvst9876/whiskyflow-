import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localParts } from "@/core/time";
import { parseSettings } from "../merchants/settings";
import { buildButtons, renderTemplate, TEMPLATES } from "./templates";
import { expiryWarningAt, firstReminderAt, winBackDue } from "./timing";

const s = parseSettings({}).messaging;
const tz = "Asia/Singapore";
const issued = new Date("2026-10-02T12:00:00Z"); // Fri 20:00 SGT

describe("firstReminderAt", () => {
  it("waits a share of the typical gap, clamped, at the send hour", () => {
    const at = firstReminderAt(issued, 14, null, s, tz); // 14 × 0.6 ≈ 8 days
    const local = localParts(at, tz);
    assert.equal(local.hour, s.sendHour);
    const days = (at.getTime() - issued.getTime()) / 86_400_000;
    assert.ok(days >= 7.5 && days <= 9, String(days));
  });

  it("moves to the day before the customer's usual day", () => {
    const at = firstReminderAt(issued, 14, 6, s, tz); // usual: Saturday → remind Friday
    const local = localParts(at, tz);
    assert.equal(local.weekday, 5);
    assert.equal(local.hour, s.sendHour);
    assert.ok(at.getTime() > issued.getTime() + s.reminderMinDays * 86_400_000);
  });

  it("clamps very long gaps to the maximum", () => {
    const at = firstReminderAt(issued, 200, null, s, tz);
    assert.ok(at.getTime() - issued.getTime() <= (s.reminderMaxDays + 1) * 86_400_000);
  });
});

describe("expiryWarningAt and winBackDue", () => {
  it("warns before expiry at the send hour, never after", () => {
    const expires = new Date("2026-12-01T15:59:00Z");
    const at = expiryWarningAt(expires, issued, s, tz)!;
    assert.equal(localParts(at, tz).hour, s.sendHour);
    assert.ok(expires.getTime() - at.getTime() > (s.expiryWarningDays - 1) * 86_400_000);
    assert.equal(expiryWarningAt(expires, new Date("2026-11-30T00:00:00Z"), s, tz), null);
  });

  it("is due only after the configured absence", () => {
    assert.equal(winBackDue(null, issued, new Date(issued.getTime() + 10 * 86_400_000), s), false);
    assert.equal(winBackDue(null, issued, new Date(issued.getTime() + 31 * 86_400_000), s), true);
  });
});

describe("templates", () => {
  it("renders the brief's reminder copy", () => {
    const body = renderTemplate(TEMPLATES.anchor_reminder.body, {
      label: "2 Pints Remaining",
      merchant: "Hop & Barrel",
      personal_line: "",
      offer_line: " Come down Friday and add our burger + fries for $16.",
    });
    assert.equal(body, "You still have 2 Pints Remaining at Hop & Barrel. Come down Friday and add our burger + fries for $16.");
  });

  it("builds wallet buttons with action hints", () => {
    const buttons = buildButtons("anchor_reminder", "https://x.test/w/abc", "");
    assert.deepEqual(
      buttons.map((b) => b.url),
      ["https://x.test/w/abc?action=reserve", "https://x.test/w/abc"],
    );
  });
});
