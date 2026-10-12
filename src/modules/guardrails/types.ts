/** Guardrail engine types. */

import type { MerchantSettings } from "../merchants/settings";
import type { MessageCategory, RecipientFacts, TemplateKey } from "../messaging/types";
import type { ExposureFact, OfferTypeKey } from "../offers/types";
import type { Segment } from "../scoring/types";

/** Where a guardrail check happens. */
export type GuardrailKind = "checkout_offer" | "message_offer" | "message";

export interface GuardrailInput {
  now: Date;
  kind: GuardrailKind;
  /** The offer being considered (absent for plain messages). */
  offer?: {
    offerType: OfferTypeKey;
    isDiscount: boolean;
    /** Merchant cost of the promotion (perk cost, discount value). Paid anchors are 0. */
    promoCostCents: number;
    isWinBack: boolean;
    /** Deal economics for checkout anchors (re-checked here as a safety net). */
    deal?: {
      deltaECents: number;
      todayMarginRate: number;
      depth: number;
      coveredRetailCents: number;
      /** Value one return visit can redeem; defaults to coveredRetailCents. */
      perVisitCoveredRetailCents?: number;
      expectedNextVisitSpendCents: number;
    } | null;
  };
  customer?: {
    identified: boolean;
    segment: Segment | null;
    activeAnchorCount: number;
  };
  /** This customer's past offer exposures (newest first is not required). */
  history?: ExposureFact[];
  /** Current visit state for checkout offers. */
  visit?: { hasOtherPromo: boolean } | null;
  merchant?: {
    outstandingLiabilityCents: number;
    addedLiabilityCents: number;
    blackoutReason: string | null;
  };
  /** Plain message dispatch context. */
  message?: {
    templateKey: TemplateKey | null;
    category: MessageCategory;
    isReminder: boolean;
    /** null when the message is not about a specific entitlement. */
    entitlementActive: boolean | null;
    timeZone: string;
    recipient: RecipientFacts;
  };
}

export interface RuleOutcome {
  passed: boolean;
  reason: string;
  /** Not applicable to this input (counts as passed). */
  skipped?: boolean;
  /** For timing rules: try again at this instant instead of suppressing. */
  deferUntil?: Date;
}

export interface GuardrailRule {
  key: string;
  label: string;
  description: string;
  /** Critical rules cannot be disabled by merchants. */
  critical: boolean;
  appliesTo: GuardrailKind[];
  check(input: GuardrailInput, settings: MerchantSettings): RuleOutcome;
}

export interface GuardrailResult extends RuleOutcome {
  key: string;
  label: string;
  critical: boolean;
  disabled?: boolean;
}

export interface GuardrailEvaluation {
  allowed: boolean;
  /** Earliest instant a deferring rule allows (when allowed is false only because of deferrals). */
  deferUntil: Date | null;
  results: GuardrailResult[];
  blockedBy: GuardrailResult[];
}
