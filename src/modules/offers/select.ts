/**
 * Selection policy "prefer-non-discount": among offers the segment's playbook allows and
 * the guardrails accept, choose non-discount perks first, then the cheapest, avoiding a
 * repeat of the customer's last offer type. Returns every candidate with its reasons.
 */
import type { GuardrailEvaluation } from "../guardrails/types";
import type { OfferDefinition, OfferTypeKey } from "./types";

export interface SelectionContext {
  allowedTypes: readonly string[];
  discountsAllowed: boolean;
  lastOfferType: OfferTypeKey | null;
  /** Guardrail evaluation for one definition (closure over customer + history). */
  evaluate(def: OfferDefinition): GuardrailEvaluation;
}

export interface SelectionResult {
  chosen: OfferDefinition | null;
  considered: { definitionId: string; name: string; allowed: boolean; reasons: string[] }[];
}

export function selectOffer(definitions: OfferDefinition[], ctx: SelectionContext): SelectionResult {
  const considered: SelectionResult["considered"] = [];
  const eligible: OfferDefinition[] = [];
  for (const def of definitions) {
    if (def.status !== "active") continue;
    const reasons: string[] = [];
    if (!ctx.allowedTypes.includes(def.offerType)) reasons.push("Not in this segment's playbook");
    if (def.isDiscount && !ctx.discountsAllowed) reasons.push("Segment does not receive discounts");
    if (reasons.length === 0) {
      const evaluation = ctx.evaluate(def);
      for (const r of evaluation.blockedBy) reasons.push(r.reason);
    }
    considered.push({ definitionId: def.id, name: def.name, allowed: reasons.length === 0, reasons });
    if (reasons.length === 0) eligible.push(def);
  }
  eligible.sort(
    (a, b) =>
      Number(a.isDiscount) - Number(b.isDiscount) ||
      Number(a.offerType === ctx.lastOfferType) - Number(b.offerType === ctx.lastOfferType) ||
      a.estCostCents - b.estCostCents,
  );
  return { chosen: eligible[0] ?? null, considered };
}
