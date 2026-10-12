import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "../auth/schema";
import { customers } from "../customers/schema";
import type { Arm } from "../experiments/types";
import { merchants } from "../merchants/schema";
import { offerDefinitions } from "../offers/schema";
import type { CampaignKind, CampaignStatus } from "./types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    kind: text("kind").$type<CampaignKind>().notNull(),
    name: text("name").notNull(),
    segment: text("segment").notNull(),
    offerDefinitionId: uuid("offer_definition_id").references(() => offerDefinitions.id, { onDelete: "set null" }),
    status: text("status").$type<CampaignStatus>().notNull().default("draft"),
    /** Holdout share in basis points. */
    holdoutBp: integer("holdout_bp").notNull(),
    audienceCount: integer("audience_count").notNull().default(0),
    expectedCostCents: integer("expected_cost_cents").notNull().default(0),
    expectedReturnCents: integer("expected_return_cents").notNull().default(0),
    scheduledFor: ts("scheduled_for"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("campaigns_merchant_idx").on(t.merchantId, t.createdAt)],
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    arm: text("arm").$type<Arm>().notNull(),
    messageId: uuid("message_id"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("campaign_recipients_uq").on(t.campaignId, t.customerId)],
);
