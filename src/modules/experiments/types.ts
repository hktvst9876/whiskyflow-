/** Experiment (holdout) domain types. */

export type Arm = "treatment" | "holdout";
export type UnitType = "customer" | "visit";
export type ExperimentStatus = "running" | "stopped";

/** The always-on experiment behind checkout anchor offers. */
export const CHECKOUT_EXPERIMENT_KEY = "checkout_anchor";

export interface Experiment {
  id: string;
  merchantId: string;
  key: string;
  name: string;
  holdoutRate: number;
  status: ExperimentStatus;
  salt: string;
  startedAt: Date;
  stoppedAt: Date | null;
}

export interface Assignment {
  experimentId: string;
  unitType: UnitType;
  unitId: string;
  arm: Arm;
  customerId: string | null;
  visitId: string | null;
  assignedAt: Date;
}

/** Outcome of one matured assignment for the lift calculation. */
export interface AssignmentOutcome {
  arm: Arm;
  /** Contribution (GP − promo cost − outstanding anchor cost) over the horizon, in cents. */
  contributionCents: number;
  /** Visits after the assignment visit, within the horizon. */
  returnVisits: number;
}

export interface LiftEstimate {
  treatmentN: number;
  holdoutN: number;
  treatmentMeanCents: number;
  holdoutMeanCents: number;
  /** treatment − holdout, in cents per customer. */
  diffCents: number;
  standardErrorCents: number;
  /** 90% confidence interval for the difference. */
  ci90LowCents: number;
  ci90HighCents: number;
  treatmentReturnRate: number;
  holdoutReturnRate: number;
  /** Return-rate difference (treatment − holdout). */
  returnRateLift: number;
  /** A plain-language verdict that never overstates the evidence. */
  verdict: "insufficient_data" | "positive" | "negative" | "inconclusive";
}
