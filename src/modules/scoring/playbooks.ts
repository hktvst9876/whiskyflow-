/**
 * Segment playbooks: what each segment may receive. Discounts are the exception, not the
 * default; recognition and low-cost perks come first. Edit here to change strategy.
 */
import { formatRelative } from "@/core/time";
import type { NextAction, Playbook, Segment } from "./types";

export const PLAYBOOKS: Record<Segment, Playbook> = {
  high_value: {
    segment: "high_value",
    label: "High value",
    description: "Spends well or brings groups. Recognise and reserve; never train them to wait for discounts.",
    allowedOfferTypes: ["anchor_upgrade", "priority_booking", "premium_upgrade", "new_menu", "renewal_bonus"],
    discountsAllowed: false,
    preferredPerks: ["priority_booking", "reserved seating", "premium upgrade"],
    cadenceDays: 21,
  },
  likely_regular: {
    segment: "likely_regular",
    label: "Likely regular",
    description: "Already likely to return. Use recognition, convenience and early access, not money.",
    allowedOfferTypes: ["anchor_upgrade", "priority_booking", "new_menu", "renewal_bonus"],
    discountsAllowed: false,
    preferredPerks: ["priority_booking", "new menu early access"],
    cadenceDays: 30,
  },
  price_sensitive: {
    segment: "price_sensitive",
    label: "Price sensitive",
    description: "Responds mainly to deals. Controlled offers only, frequency-capped, never escalating.",
    allowedOfferTypes: ["anchor_upgrade", "stored_addon", "food_drink_attach", "off_peak_perk"],
    discountsAllowed: true,
    preferredPerks: ["off-peak perk", "bundle"],
    cadenceDays: 30,
  },
  at_risk: {
    segment: "at_risk",
    label: "At risk",
    description: "Owns something but hasn't returned. Remind, warn before expiry, small comeback perk at most.",
    allowedOfferTypes: ["anchor_upgrade", "win_back_perk", "stored_addon", "off_peak_perk"],
    discountsAllowed: false,
    preferredPerks: ["complimentary drink", "complimentary side"],
    cadenceDays: 14,
  },
  persuadable: {
    segment: "persuadable",
    label: "Persuadable",
    description: "Could go either way. The anchor reminder plus a pairing or bring-a-friend does the work.",
    allowedOfferTypes: ["anchor_upgrade", "stored_addon", "food_drink_attach", "bring_a_friend", "new_menu"],
    discountsAllowed: true,
    preferredPerks: ["food pairing", "bring a friend"],
    cadenceDays: 14,
  },
  new: {
    segment: "new",
    label: "New",
    description: "First visit. Make sure they claim their anchor and know exactly what they own.",
    allowedOfferTypes: ["anchor_upgrade", "stored_addon", "food_drink_attach"],
    discountsAllowed: false,
    preferredPerks: ["food pairing"],
    cadenceDays: 14,
  },
  occasional: {
    segment: "occasional",
    label: "Occasional",
    description: "Visits now and then. Light-touch reminders and pairings.",
    allowedOfferTypes: ["anchor_upgrade", "stored_addon", "food_drink_attach", "new_menu", "off_peak_perk"],
    discountsAllowed: false,
    preferredPerks: ["food pairing"],
    cadenceDays: 21,
  },
};

export interface NextActionInput {
  now: Date;
  segment: Segment | null;
  /** Active or pending anchors: label, status and expiry. */
  anchors: { label: string; status: string; expiresAt: Date | null }[];
  lastOfferAt: Date | null;
  offerCooldownDays: number;
  expiryWarningDays: number;
}

/** The single most useful thing to do next for a customer. */
export function nextRecommendedAction(input: NextActionInput): NextAction {
  const { now, segment, anchors } = input;
  const pending = anchors.find((a) => a.status === "pending_claim");
  if (pending) {
    return { key: "claim_pending", label: "Help them claim", detail: `${pending.label} is not claimed yet — ask staff to claim by phone next visit.` };
  }
  const active = anchors.filter((a) => a.status === "active");
  const soonest = active
    .filter((a) => a.expiresAt)
    .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())[0];
  if (soonest?.expiresAt && soonest.expiresAt.getTime() - now.getTime() <= input.expiryWarningDays * 86_400_000) {
    return { key: "expiry_reminder", label: "Expiry reminder", detail: `${soonest.label} expires ${formatRelative(soonest.expiresAt, now)}.` };
  }
  if (input.lastOfferAt && now.getTime() - input.lastOfferAt.getTime() < input.offerCooldownDays * 86_400_000) {
    const until = new Date(input.lastOfferAt.getTime() + input.offerCooldownDays * 86_400_000);
    return { key: "cooldown", label: "Cooling down", detail: `Received an offer recently; next offer allowed ${formatRelative(until, now)}.` };
  }
  switch (segment) {
    case "at_risk":
      return active.length > 0
        ? { key: "win_back", label: "Win back", detail: `Remind them ${active[0]!.label} — non-discount perk at most.` }
        : { key: "win_back", label: "Win back", detail: "Lapsed. Offer an anchor on their next visit rather than a discount now." };
    case "high_value":
      return { key: "vip", label: "VIP treatment", detail: "Offer priority booking or a group package. No discounts." };
    case "likely_regular":
      return { key: "recognise", label: "Recognise", detail: "Likely to return anyway — recognise them, don't subsidise." };
    case "price_sensitive":
      return { key: "controlled_offer", label: "Controlled offer", detail: "Only capped, non-escalating offers (off-peak perk, bundle)." };
    default:
      if (active.length > 0) return { key: "reminder", label: "Reminder", detail: `${active[0]!.label} — remind with a food pairing.` };
      return { key: "offer_anchor_next_visit", label: "Anchor next visit", detail: "No anchor yet — the deal engine will look for one at checkout." };
  }
}
