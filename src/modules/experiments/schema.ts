import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { merchants } from "../merchants/schema";
import type { Arm, ExperimentStatus, UnitType } from "./types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const experiments = pgTable(
  "experiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** Holdout share in basis points (2000 = 20%). */
    holdoutBp: integer("holdout_bp").notNull(),
    status: text("status").$type<ExperimentStatus>().notNull().default("running"),
    salt: text("salt").notNull(),
    startedAt: ts("started_at").defaultNow().notNull(),
    stoppedAt: ts("stopped_at"),
  },
  (t) => [uniqueIndex("experiments_merchant_key_uq").on(t.merchantId, t.key)],
);

export const experimentAssignments = pgTable(
  "experiment_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    unitType: text("unit_type").$type<UnitType>().notNull(),
    unitId: uuid("unit_id").notNull(),
    arm: text("arm").$type<Arm>().notNull(),
    /** Customer known at assignment time (only these enter the causal comparison). */
    customerId: uuid("customer_id"),
    /** The visit on which the unit was first assigned. */
    visitId: uuid("visit_id"),
    assignedAt: ts("assigned_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("experiment_assignments_unit_uq").on(t.experimentId, t.unitType, t.unitId),
    index("experiment_assignments_merchant_idx").on(t.merchantId, t.assignedAt),
  ],
);
