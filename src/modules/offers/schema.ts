import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { entitlements } from "../anchors/schema";
import { customers } from "../customers/schema";
import type { DealCandidate } from "../deals/types";
import { experiments } from "../experiments/schema";
import type { Arm } from "../experiments/types";
import { merchants } from "../merchants/schema";
import { visits } from "../visits/schema";
import type {
  DecisionContext,
  DecisionOutcome,
  ExposureStatus,
  OfferChannel,
  OfferDefinitionStatus,
  OfferTypeKey,
} from "./types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const offerDefinitions = pgTable(
  "offer_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    offerType: text("offer_type").$type<OfferTypeKey>().notNull(),
    name: text("name").notNull(),
    status: text("status").$type<OfferDefinitionStatus>().notNull().default("active"),
    isDiscount: boolean("is_discount").notNull().default(false),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    estCostCents: integer("est_cost_cents").notNull().default(0),
    createdAt: ts("created_at").defaultNow().notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [index("offer_definitions_merchant_idx").on(t.merchantId, t.status)],
);

/** One checkout opportunity per visit. Never re-rolled. */
export const offerDecisions = pgTable(
  "offer_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    experimentId: uuid("experiment_id").references(() => experiments.id, { onDelete: "set null" }),
    arm: text("arm").$type<Arm>(),
    identifiedAtAssignment: boolean("identified_at_assignment").notNull().default(false),
    outcome: text("outcome").$type<DecisionOutcome>().notNull(),
    chosen: jsonb("chosen").$type<DealCandidate | null>(),
    candidates: jsonb("candidates").$type<DealCandidate[]>().notNull().default(sql`'[]'::jsonb`),
    context: jsonb("context").$type<DecisionContext>().notNull(),
    policyVersion: text("policy_version").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("offer_decisions_visit_uq").on(t.visitId),
    index("offer_decisions_merchant_idx").on(t.merchantId, t.createdAt),
  ],
);

export const offerExposures = pgTable(
  "offer_exposures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    decisionId: uuid("decision_id").references(() => offerDecisions.id, { onDelete: "set null" }),
    offerDefinitionId: uuid("offer_definition_id").references(() => offerDefinitions.id, { onDelete: "set null" }),
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Campaign and message references are kept without FKs (acyclic schema graph). */
    campaignId: uuid("campaign_id"),
    messageId: uuid("message_id"),
    entitlementId: uuid("entitlement_id").references(() => entitlements.id, { onDelete: "set null" }),
    offerType: text("offer_type").$type<OfferTypeKey>().notNull(),
    channel: text("channel").$type<OfferChannel>().notNull(),
    isDiscount: boolean("is_discount").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    expected: jsonb("expected").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<ExposureStatus>().notNull().default("shown"),
    promoCostCents: integer("promo_cost_cents").notNull().default(0),
    valueCents: integer("value_cents").notNull().default(0),
    shownAt: ts("shown_at").defaultNow().notNull(),
    respondedAt: ts("responded_at"),
    expiresAt: ts("expires_at"),
  },
  (t) => [
    index("offer_exposures_customer_idx").on(t.customerId, t.shownAt),
    index("offer_exposures_merchant_idx").on(t.merchantId, t.shownAt),
    index("offer_exposures_decision_idx").on(t.decisionId),
  ],
);
