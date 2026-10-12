import "server-only";
import { and, eq, lte } from "drizzle-orm";
import { randomToken } from "@/core/ids";
import type { Db } from "@/server/db";
import { assignArm } from "./assign";
import { experimentAssignments, experiments } from "./schema";
import type { Arm, Assignment, Experiment, UnitType } from "./types";

const toExperiment = (row: typeof experiments.$inferSelect): Experiment => ({
  id: row.id,
  merchantId: row.merchantId,
  key: row.key,
  name: row.name,
  holdoutRate: row.holdoutBp / 10_000,
  status: row.status,
  salt: row.salt,
  startedAt: row.startedAt,
  stoppedAt: row.stoppedAt,
});

/** Get or create the merchant's experiment for `key`, keeping its holdout in sync with settings. */
export async function ensureExperiment(
  db: Db,
  input: { merchantId: string; key: string; name: string; holdoutRate: number; at: Date },
): Promise<Experiment> {
  const holdoutBp = Math.round(input.holdoutRate * 10_000);
  await db
    .insert(experiments)
    .values({ merchantId: input.merchantId, key: input.key, name: input.name, holdoutBp, salt: randomToken(12), startedAt: input.at })
    .onConflictDoNothing({ target: [experiments.merchantId, experiments.key] });
  const [row] = await db.select().from(experiments).where(and(eq(experiments.merchantId, input.merchantId), eq(experiments.key, input.key)));
  if (row!.holdoutBp !== holdoutBp) {
    await db.update(experiments).set({ holdoutBp }).where(eq(experiments.id, row!.id));
    row!.holdoutBp = holdoutBp;
  }
  return toExperiment(row!);
}

export async function getExperimentByKey(db: Db, merchantId: string, key: string): Promise<Experiment | null> {
  const [row] = await db.select().from(experiments).where(and(eq(experiments.merchantId, merchantId), eq(experiments.key, key)));
  return row ? toExperiment(row) : null;
}

/**
 * Assign (or re-read) a unit's arm. The first assignment wins forever — the unique index
 * makes concurrent requests agree, and later holdout-rate changes never move a unit.
 */
export async function assignUnit(
  db: Db,
  experiment: Experiment,
  unit: { unitType: UnitType; unitId: string; customerId: string | null; visitId: string | null; at: Date },
): Promise<{ arm: Arm; created: boolean }> {
  const arm = assignArm(experiment.salt, unit.unitType, unit.unitId, experiment.holdoutRate);
  const rows = await db
    .insert(experimentAssignments)
    .values({
      merchantId: experiment.merchantId,
      experimentId: experiment.id,
      unitType: unit.unitType,
      unitId: unit.unitId,
      arm,
      customerId: unit.customerId,
      visitId: unit.visitId,
      assignedAt: unit.at,
    })
    .onConflictDoNothing({ target: [experimentAssignments.experimentId, experimentAssignments.unitType, experimentAssignments.unitId] })
    .returning();
  if (rows[0]) return { arm: rows[0].arm, created: true };
  const [existing] = await db
    .select()
    .from(experimentAssignments)
    .where(
      and(
        eq(experimentAssignments.experimentId, experiment.id),
        eq(experimentAssignments.unitType, unit.unitType),
        eq(experimentAssignments.unitId, unit.unitId),
      ),
    );
  return { arm: existing!.arm, created: false };
}

/** Customer-unit assignments old enough to have a full outcome window. */
export async function maturedCustomerAssignments(db: Db, experimentId: string, maturedBefore: Date): Promise<Assignment[]> {
  const rows = await db
    .select()
    .from(experimentAssignments)
    .where(
      and(
        eq(experimentAssignments.experimentId, experimentId),
        eq(experimentAssignments.unitType, "customer"),
        lte(experimentAssignments.assignedAt, maturedBefore),
      ),
    );
  return rows.map((r) => ({ experimentId: r.experimentId, unitType: r.unitType, unitId: r.unitId, arm: r.arm, customerId: r.customerId, visitId: r.visitId, assignedAt: r.assignedAt }));
}

export async function allAssignments(db: Db, experimentId: string): Promise<Assignment[]> {
  const rows = await db.select().from(experimentAssignments).where(eq(experimentAssignments.experimentId, experimentId));
  return rows.map((r) => ({ experimentId: r.experimentId, unitType: r.unitType, unitId: r.unitId, arm: r.arm, customerId: r.customerId, visitId: r.visitId, assignedAt: r.assignedAt }));
}
