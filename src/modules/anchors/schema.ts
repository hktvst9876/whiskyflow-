import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "../auth/schema";
import { catalogItems } from "../catalog/schema";
import { customers } from "../customers/schema";
import { merchants } from "../merchants/schema";
import { visits } from "../visits/schema";
import type {
  ActorType,
  AnchorCoverage,
  AnchorIssueMode,
  AnchorPricing,
  AnchorProgramStatus,
  AnchorRedemptionRules,
  AnchorTrigger,
  AnchorUnitType,
  EntitlementEventType,
  EntitlementStatus,
  RefundPolicy,
  TermsSnapshot,
} from "./types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const anchorPrograms = pgTable(
  "anchor_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").$type<AnchorProgramStatus>().notNull().default("active"),
    issueMode: text("issue_mode").$type<AnchorIssueMode>().notNull(),
    unitType: text("unit_type").$type<AnchorUnitType>().notNull(),
    unitLabel: text("unit_label").notNull(),
    unitLabelPlural: text("unit_label_plural").notNull(),
    unitsGranted: integer("units_granted").notNull(),
    coverage: jsonb("coverage").$type<AnchorCoverage>().notNull(),
    trigger: jsonb("trigger").$type<AnchorTrigger>().notNull().default({}),
    pricing: jsonb("pricing").$type<AnchorPricing>().notNull(),
    validityDays: integer("validity_days").notNull(),
    redemption: jsonb("redemption").$type<AnchorRedemptionRules>().notNull().default({}),
    transferable: boolean("transferable").notNull().default(false),
    refundPolicy: text("refund_policy").$type<RefundPolicy>().notNull().default("unused_within_14_days"),
    upgradeAllowed: boolean("upgrade_allowed").notNull().default(true),
    terms: text("terms").notNull().default(""),
    createdAt: ts("created_at").defaultNow().notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [index("anchor_programs_merchant_idx").on(t.merchantId, t.status)],
);

/** A Return Anchor owned by a customer. `quantity_remaining` mirrors the ledger. */
export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    programId: uuid("program_id").references(() => anchorPrograms.id, { onDelete: "set null" }),
    originVisitId: uuid("origin_visit_id").references(() => visits.id, { onDelete: "set null" }),
    itemId: uuid("item_id").references(() => catalogItems.id, { onDelete: "set null" }),
    /** How it was created; stored purchases were already expensed when sold. */
    issueMode: text("issue_mode").$type<AnchorIssueMode>().notNull(),
    displayName: text("display_name").notNull(),
    unitType: text("unit_type").$type<AnchorUnitType>().notNull(),
    unitLabel: text("unit_label").notNull(),
    unitLabelPlural: text("unit_label_plural").notNull(),
    quantityInitial: integer("quantity_initial").notNull(),
    quantityRemaining: integer("quantity_remaining").notNull(),
    coveredCategory: text("covered_category"),
    maxCoveredPriceCents: integer("max_covered_price_cents"),
    unitRetailCents: integer("unit_retail_cents").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    pricePaidCents: integer("price_paid_cents").notNull().default(0),
    storageLocation: text("storage_location"),
    expiresAt: ts("expires_at"),
    transferable: boolean("transferable").notNull().default(false),
    termsSnapshot: jsonb("terms_snapshot").$type<TermsSnapshot>().notNull(),
    status: text("status").$type<EntitlementStatus>().notNull(),
    claimTokenHash: text("claim_token_hash").unique(),
    claimExpiresAt: ts("claim_expires_at"),
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").defaultNow().notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("entitlements_merchant_status_idx").on(t.merchantId, t.status),
    index("entitlements_customer_idx").on(t.customerId, t.status),
    index("entitlements_origin_visit_idx").on(t.originVisitId),
    check("entitlements_quantity_nonneg", sql`${t.quantityRemaining} >= 0 and ${t.quantityRemaining} <= ${t.quantityInitial}`),
  ],
);

/** Append-only ledger. Invariant: quantity_after = previous + delta, never negative. */
export const entitlementEvents = pgTable(
  "entitlement_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => entitlements.id, { onDelete: "cascade" }),
    type: text("type").$type<EntitlementEventType>().notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    quantityAfter: integer("quantity_after").notNull(),
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "set null" }),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: uuid("actor_id"),
    note: text("note"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("entitlement_events_entitlement_idx").on(t.entitlementId, t.createdAt),
    index("entitlement_events_merchant_type_idx").on(t.merchantId, t.type, t.createdAt),
    check("entitlement_events_after_nonneg", sql`${t.quantityAfter} >= 0`),
  ],
);
