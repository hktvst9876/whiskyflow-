import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { merchants } from "../merchants/schema";
import type { ItemKind } from "./types";

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    kind: text("kind").$type<ItemKind>().notNull().default("product"),
    priceCents: integer("price_cents").notNull(),
    costCents: integer("cost_cents").notNull(),
    active: boolean("active").notNull().default(true),
    anchorable: boolean("anchorable").notNull().default(false),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    description: text("description"),
    /** POS item code, used to map ingested order lines to catalog items. */
    sku: text("sku"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("catalog_items_merchant_idx").on(t.merchantId, t.category),
    uniqueIndex("catalog_items_merchant_sku_uq").on(t.merchantId, t.sku).where(sql`${t.sku} is not null`),
    check("catalog_items_price_nonneg", sql`${t.priceCents} >= 0 and ${t.costCents} >= 0`),
  ],
);
