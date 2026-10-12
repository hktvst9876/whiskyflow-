import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { entitlements } from "../anchors/schema";
import { customers } from "../customers/schema";
import { merchants } from "../merchants/schema";
import type { MessageButton, MessageCategory, MessageDirection, MessageStatus, TemplateKey } from "./types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Outbox + inbox. Scheduled rows are dispatched by the scheduler through the send policy. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    direction: text("direction").$type<MessageDirection>().notNull(),
    channel: text("channel").$type<"whatsapp">().notNull().default("whatsapp"),
    templateKey: text("template_key").$type<TemplateKey>(),
    category: text("category").$type<MessageCategory>().notNull(),
    toPhone: text("to_phone"),
    body: text("body").notNull(),
    variables: jsonb("variables").$type<Record<string, string>>().notNull().default({}),
    buttons: jsonb("buttons").$type<MessageButton[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status").$type<MessageStatus>().notNull(),
    scheduledFor: ts("scheduled_for").defaultNow().notNull(),
    sentAt: ts("sent_at"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    suppressReason: text("suppress_reason"),
    dedupeKey: text("dedupe_key"),
    entitlementId: uuid("entitlement_id").references(() => entitlements.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id"),
    offerExposureId: uuid("offer_exposure_id"),
    estCostCents: integer("est_cost_cents").notNull().default(0),
    createdAt: ts("created_at").defaultNow().notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("messages_due_idx").on(t.status, t.scheduledFor),
    index("messages_customer_idx").on(t.customerId, t.createdAt),
    index("messages_merchant_idx").on(t.merchantId, t.createdAt),
    index("messages_provider_id_idx").on(t.providerMessageId),
    uniqueIndex("messages_merchant_dedupe_uq").on(t.merchantId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  ],
);
