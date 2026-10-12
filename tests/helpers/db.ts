import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { migrationsFolder } from "@/server/migrate";
import type { Db } from "@/server/db";

/**
 * A fresh in-memory Postgres (PGlite) with every migration applied. Each test file gets
 * its own database, so tests never share state.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const pglite = new PGlite("memory://");
  await pglite.waitReady;
  const db = drizzle(pglite);
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return { db: db as unknown as Db, close: () => pglite.close() };
}

/** A fixed Monday evening in Singapore (19:00 SGT) used as "now" in tests. */
export const MONDAY_EVENING = new Date("2026-10-05T11:00:00.000Z");

export const days = (n: number) => n * 86_400_000;
export const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
