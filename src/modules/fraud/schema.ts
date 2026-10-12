import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "../auth/schema";
import { merchants } from "../merchants/schema";
import type { FraudSeverity, FraudStatus } from "./types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const fraudFlags = pgTable(
  "fraud_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    ruleKey: text("rule_key").notNull(),
    severity: text("severity").$type<FraudSeverity>().notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<FraudStatus>().notNull().default("open"),
    createdAt: ts("created_at").defaultNow().notNull(),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [index("fraud_flags_merchant_idx").on(t.merchantId, t.status, t.createdAt)],
);
