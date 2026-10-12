/**
 * Deterministic holdout assignment: the same unit always lands in the same arm, so an
 * offer can never be "re-rolled" by reloading a screen or splitting a bill.
 *   arm = hash(salt:unitType:unitId) < holdoutRate ? holdout : treatment
 * Customer unit when the customer is identified at assignment, else the visit.
 */
import { hashToUnit } from "@/core/hash";
import type { Arm, UnitType } from "./types";

export function assignArm(salt: string, unitType: UnitType, unitId: string, holdoutRate: number): Arm {
  return hashToUnit(`${salt}:${unitType}:${unitId}`) < holdoutRate ? "holdout" : "treatment";
}

/** Pick the assignment unit for a checkout opportunity. */
export function assignmentUnit(visitId: string, customerId: string | null): { unitType: UnitType; unitId: string } {
  return customerId ? { unitType: "customer", unitId: customerId } : { unitType: "visit", unitId: visitId };
}
