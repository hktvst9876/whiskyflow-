/**
 * Pure ledger rules. Each function validates a change against the entitlement's current
 * state and returns the resulting balance, status and ledger event. The anchors service
 * applies the result inside a transaction with the row locked.
 */
import { ValidationError } from "@/core/errors";
import { isWithinLocalWindow, localParts, WEEKDAY_NAMES } from "@/core/time";
import type { AnchorRedemptionRules, AnchorUnitType, EntitlementStatus, LedgerChange } from "./types";

type State = {
  status: EntitlementStatus;
  unitType: AnchorUnitType;
  quantityRemaining: number;
  quantityInitial: number;
  expiresAt: Date | null;
};

export const REDEEMABLE_STATUSES: EntitlementStatus[] = ["active"];
export const OPEN_STATUSES: EntitlementStatus[] = ["pending_claim", "active"];

export function isExpired(e: Pick<State, "expiresAt">, now: Date): boolean {
  return e.expiresAt !== null && e.expiresAt.getTime() <= now.getTime();
}

function assertRedeemable(e: State, now: Date) {
  if (e.status === "pending_claim") throw new ValidationError("This anchor has not been claimed yet. Claim it first.");
  if (!REDEEMABLE_STATUSES.includes(e.status)) throw new ValidationError(`This anchor is ${e.status.replace("_", " ")}.`);
  if (isExpired(e, now)) throw new ValidationError("This anchor has expired.");
}

/** Use `quantity` units (items/sessions). */
export function applyRedeem(e: State, quantity: number, now: Date): LedgerChange {
  assertRedeemable(e, now);
  if (e.unitType === "percent") throw new ValidationError("Record the new bottle level instead.");
  if (!Number.isInteger(quantity) || quantity < 1) throw new ValidationError("Quantity must be at least 1.");
  if (quantity > e.quantityRemaining) {
    throw new ValidationError(`Only ${e.quantityRemaining} left on this anchor.`);
  }
  const after = e.quantityRemaining - quantity;
  return {
    quantityAfter: after,
    statusAfter: after === 0 ? "fully_redeemed" : "active",
    event: { type: "redeemed", quantityDelta: -quantity, quantityAfter: after, note: null },
  };
}

/** Record a new bottle level (percent). Levels can only go down; use an adjustment to correct. */
export function applyLevel(e: State, newPercent: number, now: Date): LedgerChange {
  assertRedeemable(e, now);
  if (e.unitType !== "percent") throw new ValidationError("Only bottle-style anchors have a level.");
  if (!Number.isInteger(newPercent) || newPercent < 0 || newPercent > 100) {
    throw new ValidationError("Level must be a whole number from 0 to 100.");
  }
  if (newPercent > e.quantityRemaining) {
    throw new ValidationError(`The level cannot go up (currently ${e.quantityRemaining}%). Use an adjustment.`);
  }
  if (newPercent === e.quantityRemaining) throw new ValidationError("The level has not changed.");
  return {
    quantityAfter: newPercent,
    statusAfter: newPercent === 0 ? "fully_redeemed" : "active",
    event: { type: "level_recorded", quantityDelta: newPercent - e.quantityRemaining, quantityAfter: newPercent, note: null },
  };
}

/** Manual correction by a manager, with a mandatory reason. */
export function applyAdjust(e: State, delta: number, note: string): LedgerChange {
  if (!OPEN_STATUSES.includes(e.status) && e.status !== "fully_redeemed") {
    throw new ValidationError(`Cannot adjust an anchor that is ${e.status.replace("_", " ")}.`);
  }
  if (!note.trim()) throw new ValidationError("Give a reason for the adjustment.");
  if (!Number.isInteger(delta) || delta === 0) throw new ValidationError("Adjustment must be a non-zero whole number.");
  const after = e.quantityRemaining + delta;
  if (after < 0) throw new ValidationError("The balance cannot go below zero.");
  if (after > e.quantityInitial) throw new ValidationError("The balance cannot exceed what was originally issued.");
  const statusAfter: EntitlementStatus = after === 0 ? "fully_redeemed" : e.status === "pending_claim" ? "pending_claim" : "active";
  return { quantityAfter: after, statusAfter, event: { type: "adjusted", quantityDelta: delta, quantityAfter: after, note: note.trim() } };
}

export function applyExpire(e: State): LedgerChange {
  if (!OPEN_STATUSES.includes(e.status)) throw new ValidationError("Only open anchors can expire.");
  return {
    quantityAfter: e.quantityRemaining,
    statusAfter: "expired",
    event: { type: "expired", quantityDelta: 0, quantityAfter: e.quantityRemaining, note: null },
  };
}

export function applyVoid(e: State, note: string): LedgerChange {
  if (!OPEN_STATUSES.includes(e.status)) throw new ValidationError("Only open anchors can be voided.");
  if (!note.trim()) throw new ValidationError("Give a reason for voiding.");
  return {
    quantityAfter: 0,
    statusAfter: "voided",
    event: { type: "voided", quantityDelta: -e.quantityRemaining, quantityAfter: 0, note: note.trim() },
  };
}

export function applyRefund(e: State, note: string): LedgerChange {
  if (!OPEN_STATUSES.includes(e.status)) throw new ValidationError("Only open anchors can be refunded.");
  return {
    quantityAfter: 0,
    statusAfter: "refunded",
    event: { type: "refunded", quantityDelta: -e.quantityRemaining, quantityAfter: 0, note: note.trim() || null },
  };
}

/** Is the refund policy satisfied right now? Only fully unused anchors are refundable. */
export function refundAllowed(
  e: Pick<State, "quantityRemaining" | "quantityInitial"> & { createdAt: Date; refundPolicy: string },
  now: Date,
): { ok: boolean; reason: string } {
  if (e.quantityRemaining !== e.quantityInitial) return { ok: false, reason: "Only unused anchors can be refunded." };
  if (e.refundPolicy === "none") return { ok: false, reason: "This anchor is non-refundable." };
  if (e.refundPolicy === "unused_within_14_days" && now.getTime() - e.createdAt.getTime() > 14 * 86_400_000) {
    return { ok: false, reason: "The 14-day refund window has passed." };
  }
  return { ok: true, reason: "" };
}

/**
 * Check redemption restrictions (weekday, off-peak). `requiresNewPurchase` is enforced when
 * the visit is closed, because the new purchase may be added after the redemption.
 */
export function checkRedemptionRules(
  rules: AnchorRedemptionRules,
  now: Date,
  timeZone: string,
  offPeak: { weekdays: number[]; start: string; end: string }[],
): { ok: boolean; reason: string } {
  const local = localParts(now, timeZone);
  if (rules.allowedWeekdays && rules.allowedWeekdays.length > 0 && !rules.allowedWeekdays.includes(local.weekday)) {
    const days = rules.allowedWeekdays.map((d) => WEEKDAY_NAMES[d]).join(", ");
    return { ok: false, reason: `Redeemable on ${days} only.` };
  }
  if (rules.offPeakOnly) {
    const inWindow = offPeak.some((w) => w.weekdays.includes(local.weekday) && isWithinLocalWindow(now, timeZone, w.start, w.end));
    if (!inWindow) return { ok: false, reason: "Redeemable during off-peak hours only." };
  }
  return { ok: true, reason: "" };
}

/** Cost recognised when units are consumed. Stored purchases were expensed when sold. */
export function redemptionCostCents(
  e: { issueMode: "upgrade_offer" | "stored_purchase"; unitType: AnchorUnitType; unitCostCents: number },
  unitsConsumed: number,
): number {
  if (e.issueMode === "stored_purchase") return 0;
  if (e.unitType === "percent") return Math.round((e.unitCostCents * unitsConsumed) / 100);
  return e.unitCostCents * unitsConsumed;
}

/** Retail value of what remains (for liability and wallet display). */
export function remainingRetailCents(e: { unitType: AnchorUnitType; unitRetailCents: number; quantityRemaining: number }): number {
  if (e.unitType === "percent") return Math.round((e.unitRetailCents * e.quantityRemaining) / 100);
  return e.unitRetailCents * e.quantityRemaining;
}

/** Cost of what remains (outstanding liability at cost). */
export function remainingCostCents(e: {
  issueMode: "upgrade_offer" | "stored_purchase";
  unitType: AnchorUnitType;
  unitCostCents: number;
  quantityRemaining: number;
}): number {
  return redemptionCostCents(e, e.quantityRemaining);
}
