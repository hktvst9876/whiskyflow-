import "server-only";
import { and, eq } from "drizzle-orm";
import { formatDate, WEEKDAY_NAMES } from "@/core/time";
import type { Db } from "@/server/db";
import { getWhatsAppProvider } from "@/integrations/whatsapp";
import { env } from "@/config/env";
import { entitlementLabel } from "@/modules/anchors/labels";
import { getEntitlement, openAnchorCount, outstandingLiabilityCents, type EntitlementRecord } from "@/modules/anchors/repo";
import { listItems } from "@/modules/catalog/repo";
import type { CatalogItem } from "@/modules/catalog/types";
import { getCustomer, walletTokenFor, type CustomerWithPromo } from "@/modules/customers/repo";
import type { Customer } from "@/modules/customers/types";
import { evaluateGuardrails } from "@/modules/guardrails/evaluate";
import { loadMerchantContext, type MerchantContext } from "@/modules/merchants/repo";
import { firstReminderAt, expiryWarningAt } from "@/modules/messaging/timing";
import { claimDueMessages, countMarketingSent, insertMessage, toMessage, updateMessage } from "@/modules/messaging/repo";
import { messages } from "@/modules/messaging/schema";
import { buildButtons, renderTemplate, TEMPLATES } from "@/modules/messaging/templates";
import type { Message, MessageCategory, RecipientFacts, TemplateKey } from "@/modules/messaging/types";
import { offerKind } from "@/modules/offers/kinds";
import { exposureFactsForCustomer, insertExposure, listDefinitions } from "@/modules/offers/repo";
import { selectOffer } from "@/modules/offers/select";
import type { OfferDefinition, OfferTypeKey } from "@/modules/offers/types";
import { PLAYBOOKS } from "@/modules/scoring/playbooks";
import type { Segment } from "@/modules/scoring/types";
import { blackoutReason, walletUrl } from "./context";

/**
 * WhatsApp outbox. Messages are planned into the `messages` table (status `scheduled`)
 * and sent by `dispatchDueMessages` (scheduler tick) or `sendMessageNow` (confirmations
 * and replies). The send-time policy — consent, quiet hours, frequency caps, "visited
 * recently", "anchor still active" — is the guardrail engine with kind "message", so a
 * message that was fine to plan can still be deferred or suppressed when it is due.
 */

/** How long an offer sent by WhatsApp stays usable at the till. */
export const MESSAGE_OFFER_VALID_DAYS = 14;

/**
 * A reminder that could not go out near its planned time (downtime, a long catch-up) has
 * missed its moment; sending it days late is noise, so it is dropped instead.
 */
export const STALE_REMINDER_DAYS = 3;

function costFor(category: MessageCategory, merchant: MerchantContext): number {
  if (category === "utility") return merchant.settings.messaging.utilityCostCents;
  if (category === "marketing") return merchant.settings.messaging.marketingCostCents;
  return 0;
}

export interface ScheduleInput {
  merchant: MerchantContext;
  customer: Pick<Customer, "id" | "phoneE164">;
  templateKey: TemplateKey;
  variables: Record<string, string>;
  scheduledFor: Date;
  dedupeKey: string | null;
  entitlementId?: string | null;
  campaignId?: string | null;
  offerExposureId?: string | null;
  at: Date;
}

/** Plan one message. Returns null when the dedupe key already exists or there is no phone. */
export async function scheduleMessage(db: Db, input: ScheduleInput): Promise<Message | null> {
  if (!input.customer.phoneE164) return null;
  const template = TEMPLATES[input.templateKey];
  const variables = { merchant: input.merchant.merchant.name, ...input.variables };
  const token = await walletTokenFor(db, input.merchant.merchant.id, input.customer.id, input.at);
  return insertMessage(db, {
    merchantId: input.merchant.merchant.id,
    customerId: input.customer.id,
    direction: "outbound",
    templateKey: input.templateKey,
    category: template.category,
    toPhone: input.customer.phoneE164,
    body: renderTemplate(template.body, variables),
    variables,
    buttons: buildButtons(input.templateKey, walletUrl(token), input.merchant.settings.business.bookingUrl || null),
    status: "scheduled",
    scheduledFor: input.scheduledFor,
    dedupeKey: input.dedupeKey,
    entitlementId: input.entitlementId ?? null,
    campaignId: input.campaignId ?? null,
    offerExposureId: input.offerExposureId ?? null,
    estCostCents: costFor(template.category, input.merchant),
    at: input.at,
  });
}

function expiryText(e: Pick<EntitlementRecord, "expiresAt">, merchant: MerchantContext): string {
  return e.expiresAt
    ? formatDate(e.expiresAt, { locale: merchant.merchant.locale, timeZone: merchant.merchant.timezone })
    : "no expiry date";
}

function personalLine(customer: Pick<Customer, "preferredWeekday">): string {
  if (customer.preferredWeekday === null) return "";
  return ` See you ${WEEKDAY_NAMES[customer.preferredWeekday]}?`;
}

/**
 * Plan the messages that follow a claimed anchor: confirmation (now), the first reminder
 * (timed from the customer's habits) and the expiry warning. Win-back, bottle-low and
 * renewal nudges are planned by the scheduler from the anchor's state.
 */
export async function planAnchorMessages(
  db: Db,
  merchant: MerchantContext,
  entitlement: EntitlementRecord,
  customer: Pick<Customer, "id" | "phoneE164" | "typicalGapDays" | "preferredWeekday">,
  now: Date,
): Promise<{ confirmation: Message | null }> {
  const tz = merchant.merchant.timezone;
  const s = merchant.settings.messaging;
  const label = entitlementLabel(entitlement);
  const confirmation = await scheduleMessage(db, {
    merchant,
    customer,
    templateKey: "anchor_confirmation",
    variables: { label, expiry: expiryText(entitlement, merchant) },
    scheduledFor: now,
    dedupeKey: `confirm:${entitlement.id}`,
    entitlementId: entitlement.id,
    at: now,
  });
  const reminderAt = firstReminderAt(entitlement.createdAt, customer.typicalGapDays, customer.preferredWeekday, s, tz);
  if (!entitlement.expiresAt || reminderAt.getTime() < entitlement.expiresAt.getTime()) {
    await scheduleMessage(db, {
      merchant,
      customer,
      templateKey: "anchor_reminder",
      variables: { label, personal_line: personalLine(customer), offer_line: "" },
      scheduledFor: reminderAt,
      dedupeKey: `reminder1:${entitlement.id}`,
      entitlementId: entitlement.id,
      at: now,
    });
  }
  const warnAt = expiryWarningAt(entitlement.expiresAt, now, s, tz);
  if (warnAt && warnAt.getTime() > reminderAt.getTime()) {
    await scheduleMessage(db, {
      merchant,
      customer,
      templateKey: "anchor_expiry_warning",
      variables: { label, expiry: expiryText(entitlement, merchant) },
      scheduledFor: warnAt,
      dedupeKey: `expiry:${entitlement.id}`,
      entitlementId: entitlement.id,
      at: now,
    });
  }
  return { confirmation };
}

// ── Offer selection for messages ───────────────────────────────────────────

/** Offer types that may ride along with each kind of message. */
export const MESSAGE_OFFER_TYPES: Record<"reminder" | "win_back" | "renewal", OfferTypeKey[]> = {
  reminder: ["stored_addon", "food_drink_attach", "bring_a_friend", "new_menu", "off_peak_perk", "premium_upgrade"],
  win_back: ["win_back_perk"],
  renewal: ["renewal_bonus"],
};

export interface ChosenMessageOffer {
  definition: OfferDefinition;
  isDiscount: boolean;
  promoCostCents: number;
  line: string;
}

/**
 * Choose the offer (if any) to attach to a message: allowed by the customer's segment
 * playbook, accepted by the guardrails ("message_offer"), preferring non-discount perks.
 */
export async function chooseMessageOffer(
  db: Db,
  input: {
    merchant: MerchantContext;
    customer: Pick<CustomerWithPromo, "id" | "segment">;
    types: OfferTypeKey[];
    isWinBack: boolean;
    anchorLabel: string;
    catalog?: CatalogItem[];
    definitions?: OfferDefinition[];
    now: Date;
  },
): Promise<ChosenMessageOffer | null> {
  const { merchant, customer, now } = input;
  const catalog = input.catalog ?? (await listItems(db, merchant.merchant.id));
  const definitions = (input.definitions ?? (await listDefinitions(db, merchant.merchant.id, { status: "active" }))).filter((d) =>
    input.types.includes(d.offerType),
  );
  if (definitions.length === 0) return null;
  const segment: Segment = customer.segment ?? "new";
  const playbook = PLAYBOOKS[segment];
  const history = await exposureFactsForCustomer(db, customer.id, now);
  const activeAnchorCount = await openAnchorCount(db, customer.id);
  const liability = await outstandingLiabilityCents(db, merchant.merchant.id);
  const blackout = blackoutReason(merchant.settings.business.blackouts, now, merchant.merchant.timezone);
  const lastOfferType =
    [...history].filter((h) => h.offerType !== "anchor_upgrade").sort((a, b) => b.shownAt.getTime() - a.shownAt.getTime())[0]?.offerType ?? null;
  const facts = (def: OfferDefinition) => {
    const kind = offerKind(def.offerType);
    return { isDiscount: kind.isDiscount(def.config, catalog), promoCostCents: kind.promoCostCents(def.config, catalog) };
  };
  const result = selectOffer(
    // The kind decides whether a configured offer is really a discount.
    definitions.map((d) => ({ ...d, isDiscount: facts(d).isDiscount, estCostCents: facts(d).promoCostCents })),
    {
      allowedTypes: playbook.allowedOfferTypes,
      discountsAllowed: playbook.discountsAllowed,
      lastOfferType,
      evaluate: (def) =>
        evaluateGuardrails(
          {
            now,
            kind: "message_offer",
            offer: { offerType: def.offerType, isDiscount: def.isDiscount, promoCostCents: def.estCostCents, isWinBack: input.isWinBack },
            customer: { identified: true, segment, activeAnchorCount },
            history,
            merchant: { outstandingLiabilityCents: liability, addedLiabilityCents: 0, blackoutReason: blackout },
          },
          merchant.settings,
        ),
    },
  );
  if (!result.chosen) return null;
  const def = result.chosen;
  const kind = offerKind(def.offerType);
  const line = kind.customerLine(def.config, {
    catalog,
    anchorLabel: "",
    currency: merchant.merchant.currency,
    locale: merchant.merchant.locale,
  });
  return { definition: def, isDiscount: def.isDiscount, promoCostCents: def.estCostCents, line };
}

// ── Dispatch ───────────────────────────────────────────────────────────────

async function recipientFacts(db: Db, customer: CustomerWithPromo, now: Date): Promise<RecipientFacts> {
  return {
    status: customer.status,
    phoneE164: customer.phoneE164,
    whatsappServiceOptIn: customer.whatsappServiceOptIn,
    whatsappMarketingOptIn: customer.whatsappMarketingOptIn,
    optedOutAt: customer.optedOutAt,
    lastVisitAt: customer.lastVisitAt,
    marketingSent7: await countMarketingSent(db, customer.id, new Date(now.getTime() - 7 * 86_400_000)),
    marketingSent30: await countMarketingSent(db, customer.id, new Date(now.getTime() - 30 * 86_400_000)),
  };
}

/** Which offer types (if any) a template may carry, and how its offer is phrased. */
function offerSlot(templateKey: TemplateKey | null): { purpose: keyof typeof MESSAGE_OFFER_TYPES; variable: string; format: (line: string) => string } | null {
  switch (templateKey) {
    case "anchor_reminder":
      return { purpose: "reminder", variable: "offer_line", format: (l) => ` ${l}` };
    case "anchor_win_back":
      return { purpose: "win_back", variable: "perk_line", format: (l) => (l.startsWith(" ") ? l : ` ${l}`) };
    case "anchor_renewal":
      return { purpose: "renewal", variable: "bonus_line", format: (l) => l };
    default:
      return null;
  }
}

export interface DispatchOutcome {
  messageId: string;
  status: "sent" | "delivered" | "suppressed" | "deferred" | "failed";
  reason?: string;
}

type MerchantCache = Map<string, MerchantContext>;

async function dispatchOne(db: Db, message: Message, now: Date, cache: MerchantCache): Promise<DispatchOutcome> {
  const merchant = cache.get(message.merchantId) ?? (await loadMerchantContext(db, message.merchantId));
  cache.set(message.merchantId, merchant);
  const suppress = async (reason: string): Promise<DispatchOutcome> => {
    await updateMessage(db, message.id, { status: "suppressed", suppressReason: reason, at: now });
    return { messageId: message.id, status: "suppressed", reason };
  };
  if (!message.customerId) return suppress("No customer");
  if (!merchant.settings.messaging.enabled && message.category !== "service_reply") return suppress("Messaging is switched off");

  const customer = await getCustomer(db, merchant.merchant.id, message.customerId);
  let entitlement: EntitlementRecord | null = null;
  if (message.entitlementId) entitlement = await getEntitlement(db, merchant.merchant.id, message.entitlementId);
  const template = message.templateKey ? TEMPLATES[message.templateKey] : null;
  if (template?.isReminder && now.getTime() - message.scheduledFor.getTime() > STALE_REMINDER_DAYS * 86_400_000) {
    return suppress("Missed its moment (was due more than 3 days ago)");
  }

  const evaluation = evaluateGuardrails(
    {
      now,
      kind: "message",
      message: {
        templateKey: message.templateKey,
        category: message.category,
        isReminder: template?.isReminder ?? false,
        entitlementActive: entitlement ? entitlement.status === "active" : null,
        timeZone: merchant.merchant.timezone,
        recipient: await recipientFacts(db, customer, now),
      },
    },
    merchant.settings,
  );
  if (!evaluation.allowed) {
    if (evaluation.deferUntil) {
      await updateMessage(db, message.id, { status: "scheduled", scheduledFor: evaluation.deferUntil, at: now });
      return { messageId: message.id, status: "deferred", reason: evaluation.blockedBy.map((b) => b.reason).join("; ") };
    }
    return suppress(evaluation.blockedBy.map((b) => b.reason).join("; "));
  }

  // Re-render with what is true now (balances change between planning and sending).
  const variables = { ...message.variables };
  if (entitlement) variables.label = entitlementLabel(entitlement);
  if (message.templateKey === "bottle_low" && entitlement) variables.level = String(entitlement.quantityRemaining);
  let chosen: ChosenMessageOffer | null = null;
  const slot = offerSlot(message.templateKey);
  if (message.campaignId && variables.offer_definition_id && !message.offerExposureId) {
    // Campaign offers were chosen (and guardrail-checked) at launch; record the exposure
    // only once the message actually goes out.
    const [def] = (await listDefinitions(db, merchant.merchant.id)).filter((d) => d.id === variables.offer_definition_id);
    if (def) {
      const catalog = await listItems(db, merchant.merchant.id);
      const kind = offerKind(def.offerType);
      chosen = {
        definition: def,
        isDiscount: kind.isDiscount(def.config, catalog),
        promoCostCents: kind.promoCostCents(def.config, catalog),
        line: variables.offer_line ?? def.name,
      };
    }
  } else if (slot && !message.offerExposureId && !message.campaignId) {
    chosen = await chooseMessageOffer(db, {
      merchant,
      customer,
      types: MESSAGE_OFFER_TYPES[slot.purpose],
      isWinBack: slot.purpose === "win_back",
      anchorLabel: variables.label ?? "",
      now,
    });
    variables[slot.variable] = chosen ? slot.format(chosen.line) : "";
  }
  const body = message.templateKey ? renderTemplate(TEMPLATES[message.templateKey].body, variables) : message.body;

  try {
    const provider = getWhatsAppProvider();
    const result = await provider.send({
      to: message.toPhone ?? customer.phoneE164 ?? "",
      category: message.category,
      body,
      template:
        template && template.metaName && message.category !== "service_reply"
          ? {
              name: template.metaName,
              language: env().whatsapp.templateLanguage,
              parameters: template.variables.map((v) => variables[v] ?? ""),
              buttonUrlSuffixes: message.buttons.map((b) => (b.url.includes("/w/") ? b.url.split("/w/")[1]! : "")),
            }
          : null,
      buttons: message.buttons,
    });
    let offerExposureId = message.offerExposureId;
    if (chosen) {
      const exposure = await insertExposure(db, {
        merchantId: merchant.merchant.id,
        decisionId: null,
        offerDefinitionId: chosen.definition.id,
        visitId: null,
        customerId: customer.id,
        campaignId: message.campaignId,
        messageId: message.id,
        entitlementId: entitlement?.id ?? null,
        offerType: chosen.definition.offerType,
        channel: "whatsapp",
        isDiscount: chosen.isDiscount,
        payload: { name: chosen.definition.name, line: chosen.line },
        expected: {},
        status: "shown",
        promoCostCents: chosen.promoCostCents,
        valueCents: 0,
        shownAt: now,
        expiresAt: new Date(now.getTime() + MESSAGE_OFFER_VALID_DAYS * 86_400_000),
      });
      offerExposureId = exposure.id;
    }
    await updateMessage(db, message.id, {
      status: result.status,
      sentAt: now,
      provider: provider.name,
      providerMessageId: result.providerMessageId,
      body,
      offerExposureId,
      at: now,
    });
    return { messageId: message.id, status: result.status };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await updateMessage(db, message.id, { status: "failed", error: reason.slice(0, 500), at: now });
    return { messageId: message.id, status: "failed", reason };
  }
}

/** Send every message that is due (scheduler tick). */
export async function dispatchDueMessages(db: Db, now: Date, limit = 200): Promise<DispatchOutcome[]> {
  const due = await claimDueMessages(db, now, limit);
  const cache: MerchantCache = new Map();
  const outcomes: DispatchOutcome[] = [];
  for (const message of due) outcomes.push(await dispatchOne(db, message, now, cache));
  return outcomes;
}

/** Send one scheduled message immediately (confirmations, receipts, replies). */
export async function sendMessageNow(db: Db, messageId: string, now: Date): Promise<DispatchOutcome | null> {
  const [row] = await db
    .update(messages)
    .set({ status: "sending", updatedAt: now })
    .where(and(eq(messages.id, messageId), eq(messages.status, "scheduled")))
    .returning();
  if (!row) return null;
  return dispatchOne(db, toMessage(row), now, new Map());
}
