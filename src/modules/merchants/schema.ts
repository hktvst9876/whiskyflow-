/**
 * Tenancy and integration tables. Imports only drizzle-orm and other schema files
 * (relative paths) so drizzle-kit can load it.
 */
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { MerchantStatus, Vertical } from "./types";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();

export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  vertical: text("vertical").$type<Vertical>().notNull(),
  currency: text("currency").notNull().default("SGD"),
  timezone: text("timezone").notNull().default("Asia/Singapore"),
  locale: text("locale").notNull().default("en-SG"),
  country: text("country").notNull().default("SG"),
  brandColor: text("brand_color").notNull().default("#0f766e"),
  /** Merchant overrides only; read through parseSettings(). */
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").$type<MerchantStatus>().notNull().default("active"),
  createdAt: createdAt(),
});

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    createdAt: createdAt(),
  },
  (t) => [index("locations_merchant_idx").on(t.merchantId)],
);

/** Small key/value store for process-wide state such as the demo clock offset. */
export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** First characters of the key, shown in the console so keys can be told apart. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("api_keys_merchant_idx").on(t.merchantId)],
);

/** Idempotency log for inbound webhooks (WhatsApp, POS). */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").$type<"whatsapp" | "pos">().notNull(),
    externalId: text("external_id").notNull(),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<unknown>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
    error: text("error"),
  },
  (t) => [uniqueIndex("webhook_events_source_external_uq").on(t.source, t.externalId)],
);
