import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { merchants } from "../merchants/schema";
import type { ReturnBand, ScoreFactor, Segment } from "../scoring/types";
import type { ConsentPurpose, ConsentSource, CustomerStatus } from "./types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    phoneE164: text("phone_e164"),
    displayName: text("display_name"),
    redeemCode: text("redeem_code").notNull(),
    status: text("status").$type<CustomerStatus>().notNull().default("active"),
    firstVisitAt: ts("first_visit_at"),
    lastVisitAt: ts("last_visit_at"),
    visitCount: integer("visit_count").notNull().default(0),
    totalSpendCents: integer("total_spend_cents").notNull().default(0),
    totalGpCents: integer("total_gp_cents").notNull().default(0),
    /** Average party size × 10 (integers only in storage). */
    avgPartySizeX10: integer("avg_party_size_x10").notNull().default(0),
    /** Visits that used a perk, discount or promotional offer. */
    promoVisitCount: integer("promo_visit_count").notNull().default(0),
    preferredWeekday: integer("preferred_weekday"),
    preferredHour: integer("preferred_hour"),
    typicalGapDays: integer("typical_gap_days"),
    whatsappServiceOptIn: boolean("whatsapp_service_opt_in").notNull().default(false),
    whatsappMarketingOptIn: boolean("whatsapp_marketing_opt_in").notNull().default(false),
    optedOutAt: ts("opted_out_at"),
    /** Return probability in basis points (0-10000). */
    returnProbabilityBp: integer("return_probability_bp"),
    returnBand: text("return_band").$type<ReturnBand>(),
    segment: text("segment").$type<Segment>(),
    scoreFactors: jsonb("score_factors").$type<ScoreFactor[]>(),
    scoredAt: ts("scored_at"),
    createdAt: ts("created_at").defaultNow().notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("customers_merchant_phone_uq").on(t.merchantId, t.phoneE164).where(sql`${t.phoneE164} is not null`),
    uniqueIndex("customers_merchant_redeem_code_uq").on(t.merchantId, t.redeemCode),
    index("customers_merchant_segment_idx").on(t.merchantId, t.segment),
  ],
);

/** Append-only consent log. The booleans on `customers` are the current state. */
export const customerConsents = pgTable(
  "customer_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<ConsentPurpose>().notNull(),
    granted: boolean("granted").notNull(),
    source: text("source").$type<ConsentSource>().notNull(),
    noticeVersion: text("notice_version").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("customer_consents_customer_idx").on(t.customerId, t.createdAt)],
);

/** Long-lived links to a customer's web wallet. Token = HMAC(secret, id); only the hash is stored. */
export const walletTokens = pgTable(
  "wallet_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: ts("created_at").defaultNow().notNull(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("wallet_tokens_customer_idx").on(t.customerId)],
);
