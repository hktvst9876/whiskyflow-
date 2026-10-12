import "server-only";
import { ValidationError } from "@/core/errors";
import type { Db } from "@/server/db";
import { entitlementLabel } from "@/modules/anchors/labels";
import { listEntitlementsForCustomers, openAnchorCount, outstandingLiabilityCents } from "@/modules/anchors/repo";
import { writeAudit } from "@/modules/audit/service";
import { audienceFor, suggestCampaigns, type CampaignCustomer } from "@/modules/campaigns/suggest";
import { insertCampaign, insertRecipient, updateCampaign } from "@/modules/campaigns/repo";
import type { Campaign, CampaignKind, CampaignSuggestion } from "@/modules/campaigns/types";
import { listItems } from "@/modules/catalog/repo";
import { listAllCustomers } from "@/modules/customers/repo";
import { assignArm } from "@/modules/experiments/assign";
import { evaluateGuardrails } from "@/modules/guardrails/evaluate";
import type { MerchantContext } from "@/modules/merchants/repo";
import { offerKind } from "@/modules/offers/kinds";
import { exposureFactsForCustomer, listDefinitions } from "@/modules/offers/repo";
import { merchantVisitBaseline } from "@/modules/visits/repo";
import { blackoutReason, merchantFor, type FlowContext } from "./context";
import { scheduleMessage } from "./messages";

/**
 * Campaigns: segment-targeted WhatsApp pushes, always with a holdout so the console can
 * show actual performance (treatment vs holdout), not just "messages sent".
 */

export async function campaignCustomers(db: Db, merchant: MerchantContext, now: Date): Promise<CampaignCustomer[]> {
  const customers = await listAllCustomers(db, merchant.merchant.id);
  const anchors = await listEntitlementsForCustomers(db, customers.map((c) => c.id), ["active"]);
  return customers.map((c) => {
    const mine = anchors.filter((e) => e.customerId === c.id);
    return {
      id: c.id,
      segment: c.segment,
      hasActiveAnchor: mine.length > 0,
      oneUnitLeft: mine.some((e) => e.unitType !== "percent" && e.quantityInitial > 1 && e.quantityRemaining === 1),
      daysSinceLastVisit: c.lastVisitAt ? (now.getTime() - c.lastVisitAt.getTime()) / 86_400_000 : null,
      marketingOptIn: c.whatsappMarketingOptIn && !c.optedOutAt && Boolean(c.phoneE164),
    };
  });
}

async function avgVisitGp(db: Db, merchant: MerchantContext, now: Date): Promise<number> {
  const b = await merchantVisitBaseline(db, merchant.merchant.id, new Date(now.getTime() - 90 * 86_400_000), now);
  return b.avgGpCents;
}

export async function suggestedCampaigns(db: Db, ctx: FlowContext): Promise<CampaignSuggestion[]> {
  const merchant = await merchantFor(db, ctx);
  return suggestCampaigns({
    customers: await campaignCustomers(db, merchant, ctx.now),
    definitions: await listDefinitions(db, ctx.merchantId, { status: "active" }),
    avgVisitGpCents: await avgVisitGp(db, merchant, ctx.now),
    messageCostCents: merchant.settings.messaging.marketingCostCents,
  });
}

const TEMPLATE_FOR: Record<CampaignKind, "anchor_reminder" | "anchor_win_back" | "campaign_offer" | "anchor_renewal"> = {
  anchor_reminder: "anchor_reminder",
  win_back: "anchor_win_back",
  bring_a_friend: "campaign_offer",
  new_menu: "campaign_offer",
  vip_recognition: "campaign_offer",
  renewal: "anchor_renewal",
};

/** Launch a suggested campaign: assign holdout, plan one WhatsApp per treatment customer. */
export async function launchCampaign(db: Db, ctx: FlowContext, kind: CampaignKind, options: { scheduledFor?: Date | null } = {}): Promise<Campaign> {
  const merchant = await merchantFor(db, ctx);
  const suggestions = await suggestedCampaigns(db, ctx);
  const suggestion = suggestions.find((s) => s.kind === kind);
  if (!suggestion) throw new ValidationError("Nobody fits this campaign right now.");
  const customers = await campaignCustomers(db, merchant, ctx.now);
  const audience = audienceFor(kind, customers);
  const scheduledFor = options.scheduledFor && options.scheduledFor > ctx.now ? options.scheduledFor : ctx.now;
  const holdoutRate = merchant.settings.experiment.holdoutRate;
  const campaign = await insertCampaign(db, {
    merchantId: ctx.merchantId,
    kind,
    name: suggestion.name,
    segment: suggestion.segment,
    offerDefinitionId: suggestion.offerDefinitionId,
    status: "sending",
    holdoutRate,
    audienceCount: audience.length,
    expectedCostCents: suggestion.expectedCostCents,
    expectedReturnCents: suggestion.expectedReturnCents,
    scheduledFor,
    createdBy: ctx.actor.id,
    at: ctx.now,
  });

  const definitions = await listDefinitions(db, ctx.merchantId, { status: "active" });
  const def = definitions.find((d) => d.id === suggestion.offerDefinitionId) ?? null;
  const catalog = await listItems(db, ctx.merchantId);
  const all = await listAllCustomers(db, ctx.merchantId);
  const byId = new Map(all.map((c) => [c.id, c]));
  const anchors = await listEntitlementsForCustomers(db, audience, ["active"]);
  const liability = await outstandingLiabilityCents(db, ctx.merchantId);
  const blackout = blackoutReason(merchant.settings.business.blackouts, ctx.now, merchant.merchant.timezone);
  const template = TEMPLATE_FOR[kind];

  for (const customerId of audience) {
    const customer = byId.get(customerId);
    if (!customer) continue;
    const arm = assignArm(campaign.id, "customer", customerId, holdoutRate);
    if (arm === "holdout") {
      await insertRecipient(db, { merchantId: ctx.merchantId, campaignId: campaign.id, customerId, arm, messageId: null, at: ctx.now });
      continue;
    }
    const anchor = anchors.find((e) => e.customerId === customerId) ?? null;
    const label = anchor ? entitlementLabel(anchor) : "";
    let offerLine = "";
    let offerId: string | null = null;
    if (def) {
      const kindDef = offerKind(def.offerType);
      const evaluation = evaluateGuardrails(
        {
          now: ctx.now,
          kind: "message_offer",
          offer: {
            offerType: def.offerType,
            isDiscount: kindDef.isDiscount(def.config, catalog),
            promoCostCents: kindDef.promoCostCents(def.config, catalog),
            isWinBack: def.offerType === "win_back_perk",
          },
          customer: { identified: true, segment: customer.segment, activeAnchorCount: await openAnchorCount(db, customerId) },
          history: await exposureFactsForCustomer(db, customerId, ctx.now),
          merchant: { outstandingLiabilityCents: liability, addedLiabilityCents: 0, blackoutReason: blackout },
        },
        merchant.settings,
      );
      if (evaluation.allowed) {
        offerLine = kindDef.customerLine(def.config, { catalog, anchorLabel: "", currency: merchant.merchant.currency, locale: merchant.merchant.locale }).trim();
        offerId = def.id;
      }
    }
    const variables: Record<string, string> =
      template === "campaign_offer"
        ? { headline: [label ? `You still have ${label}.` : "", offerLine || suggestion.why].filter(Boolean).join(" ") }
        : template === "anchor_win_back"
          ? { label: label || "your table", perk_line: offerLine ? ` ${offerLine}` : "" }
          : template === "anchor_renewal"
            ? { label, bonus_line: offerLine ? ` ${offerLine.replace(/^and /, "and ")}` : "" }
            : { label, personal_line: "", offer_line: offerLine ? ` ${offerLine}` : "" };
    if (offerId) {
      variables.offer_definition_id = offerId;
      variables.offer_line = offerLine;
    }
    const message = await scheduleMessage(db, {
      merchant,
      customer,
      templateKey: template,
      variables,
      scheduledFor,
      dedupeKey: `campaign:${campaign.id}:${customerId}`,
      entitlementId: template === "campaign_offer" ? null : (anchor?.id ?? null),
      campaignId: campaign.id,
      at: ctx.now,
    });
    await insertRecipient(db, { merchantId: ctx.merchantId, campaignId: campaign.id, customerId, arm, messageId: message?.id ?? null, at: ctx.now });
  }
  await updateCampaign(db, campaign.id, { status: "completed", audienceCount: audience.length });
  await writeAudit(db, {
    merchantId: ctx.merchantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    action: "campaign.launched",
    entityType: "campaign",
    entityId: campaign.id,
    data: { kind, audience: audience.length, holdoutRate },
    at: ctx.now,
  });
  return { ...campaign, status: "completed" };
}
