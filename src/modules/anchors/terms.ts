/**
 * Transparency: terms are frozen at issue (`TermsSnapshot`) and rendered as plain lines on
 * the wallet so customers always see what they own, restrictions, expiry, upgrade,
 * transfer and refund rules. No fine print, no reliance on customers forgetting.
 */
import { formatMoney } from "@/core/money";
import { formatDate, WEEKDAY_SHORT } from "@/core/time";
import type { AnchorRedemptionRules, RefundPolicy, TermsSnapshot } from "./types";

export const REFUND_POLICY_TEXT: Record<RefundPolicy, string> = {
  none: "Non-refundable.",
  unused_within_14_days: "Refundable in full if unused within 14 days of purchase.",
  unused_any_time: "Refundable in full any time while unused.",
};

export function buildTermsSnapshot(input: {
  programName: string | null;
  coverageText: string;
  expiresAt: Date | null;
  redemption: AnchorRedemptionRules;
  transferable: boolean;
  refundPolicy: RefundPolicy;
  upgradeAllowed: boolean;
  terms: string;
  pricePaidCents: number;
  currency: string;
  issuedAt: Date;
}): TermsSnapshot {
  return {
    programName: input.programName,
    coverageText: input.coverageText,
    expiresAt: input.expiresAt?.toISOString() ?? null,
    redemption: input.redemption,
    transferable: input.transferable,
    refundPolicy: input.refundPolicy,
    upgradeAllowed: input.upgradeAllowed,
    terms: input.terms,
    pricePaidCents: input.pricePaidCents,
    currency: input.currency,
    issuedAt: input.issuedAt.toISOString(),
  };
}

/** Plain-language lines for the wallet "What you own" panel. */
export function transparencyLines(
  snapshot: TermsSnapshot,
  options: { locale?: string; timeZone?: string; minNewSpendText?: string } = {},
): { label: string; value: string }[] {
  const { locale = "en-SG", timeZone = "Asia/Singapore" } = options;
  const lines: { label: string; value: string }[] = [];
  lines.push({ label: "Covers", value: snapshot.coverageText });
  lines.push({
    label: "Paid",
    value:
      snapshot.pricePaidCents > 0
        ? formatMoney(snapshot.pricePaidCents, { currency: snapshot.currency, locale })
        : "Included in your original purchase",
  });
  lines.push({
    label: "Expires",
    value: snapshot.expiresAt ? formatDate(new Date(snapshot.expiresAt), { locale, timeZone }) : "Does not expire",
  });
  const r = snapshot.redemption;
  const restrictions: string[] = [];
  if (r.allowedWeekdays && r.allowedWeekdays.length > 0 && r.allowedWeekdays.length < 7) {
    restrictions.push(`${r.allowedWeekdays.map((d) => WEEKDAY_SHORT[d]).join(", ")} only`);
  }
  if (r.offPeakOnly) restrictions.push("off-peak hours only");
  if (r.maxUnitsPerVisit) restrictions.push(`up to ${r.maxUnitsPerVisit} per visit`);
  if (r.requiresNewPurchase) {
    restrictions.push(
      r.minNewSpendCents
        ? `with a new purchase of ${formatMoney(r.minNewSpendCents, { currency: snapshot.currency, locale, compact: true })} or more`
        : "with any new purchase",
    );
  }
  lines.push({ label: "When", value: restrictions.length > 0 ? `Redeem ${restrictions.join("; ")}` : "Any time we're open" });
  lines.push({
    label: "Upgrades",
    value: snapshot.upgradeAllowed ? "You can put it towards a pricier item and pay the difference" : "No upgrades",
  });
  lines.push({ label: "Sharing", value: snapshot.transferable ? "You can transfer it to someone else" : "For you only (not transferable)" });
  lines.push({ label: "Refunds", value: REFUND_POLICY_TEXT[snapshot.refundPolicy] });
  if (snapshot.terms.trim()) lines.push({ label: "Terms", value: snapshot.terms.trim() });
  return lines;
}
