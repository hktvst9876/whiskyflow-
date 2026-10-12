import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "../auth/schema";
import { catalogItems } from "../catalog/schema";
import { customers } from "../customers/schema";
import { locations, merchants } from "../merchants/schema";
import type { LineType, VisitSource, VisitStatus } from "./types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    partySize: integer("party_size").notNull().default(1),
    status: text("status").$type<VisitStatus>().notNull().default("open"),
    source: text("source").$type<VisitSource>().notNull().default("staff"),
    externalRef: text("external_ref"),
    label: text("label"),
    openedByUserId: uuid("opened_by_user_id").references(() => users.id, { onDelete: "set null" }),
    openedAt: ts("opened_at").defaultNow().notNull(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    index("visits_merchant_status_idx").on(t.merchantId, t.status, t.openedAt),
    index("visits_customer_idx").on(t.customerId, t.openedAt),
    uniqueIndex("visits_merchant_external_ref_uq").on(t.merchantId, t.externalRef).where(sql`${t.externalRef} is not null`),
  ],
);

/**
 * Bill lines. `entitlement_id` and `offer_exposure_id` are indexed references without FK
 * constraints to keep the schema graph acyclic (anchors and offers reference visits).
 */
export const visitLines = pgTable(
  "visit_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => catalogItems.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    lineType: text("line_type").$type<LineType>().notNull().default("regular"),
    entitlementId: uuid("entitlement_id"),
    offerExposureId: uuid("offer_exposure_id"),
    createdAt: ts("created_at").defaultNow().notNull(),
    voidedAt: ts("voided_at"),
  },
  (t) => [
    index("visit_lines_visit_idx").on(t.visitId),
    index("visit_lines_entitlement_idx").on(t.entitlementId),
    check("visit_lines_quantity_positive", sql`${t.quantity} > 0`),
  ],
);
