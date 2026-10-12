/**
 * Guardrail registry. To add a rule: create a file in this folder exporting a
 * `GuardrailRule`, then add it to this list. Order is display order.
 */
import type { GuardrailRule } from "../types";
import { anchorValueCap } from "./anchor-value-cap";
import { blackoutPeriod } from "./blackout-period";
import { consentRequired } from "./consent-required";
import { cooldownAfterOffer } from "./cooldown-after-offer";
import { discountFrequency } from "./discount-frequency";
import { entitlementStillActive } from "./entitlement-still-active";
import { liabilityCap } from "./liability-cap";
import { maxActiveAnchors } from "./max-active-anchors";
import { maxDiscountDepth } from "./max-discount-depth";
import { messageFrequencyCap } from "./message-frequency-cap";
import { minContribution } from "./min-contribution";
import { minTodayMargin } from "./min-today-margin";
import { noInactivityEscalation } from "./no-inactivity-escalation";
import { noStacking } from "./no-stacking";
import { priceSensitiveFrequency } from "./price-sensitive-frequency";
import { promoCostCap } from "./promo-cost-cap";
import { quietHours } from "./quiet-hours";
import { recentlyVisited } from "./recently-visited";
import { regularsNoDiscount } from "./regulars-no-discount";
import { varyOfferType } from "./vary-offer-type";
import { winBackLimit } from "./win-back-limit";

export const GUARDRAIL_RULES: GuardrailRule[] = [
  noStacking,
  minContribution,
  minTodayMargin,
  maxDiscountDepth,
  anchorValueCap,
  cooldownAfterOffer,
  promoCostCap,
  discountFrequency,
  regularsNoDiscount,
  priceSensitiveFrequency,
  noInactivityEscalation,
  winBackLimit,
  varyOfferType,
  maxActiveAnchors,
  liabilityCap,
  blackoutPeriod,
  consentRequired,
  quietHours,
  messageFrequencyCap,
  recentlyVisited,
  entitlementStillActive,
];
