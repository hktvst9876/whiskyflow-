import "server-only";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Db } from "./db";

/**
 * Location of the generated SQL migrations. Resolved from the working directory, which is
 * the project root for `next dev/start`, scripts and tests. Override with MIGRATIONS_DIR.
 */
export function migrationsFolder(): string {
  const folder = resolve(process.env.MIGRATIONS_DIR ?? join(process.cwd(), "drizzle"));
  if (!existsSync(join(folder, "meta", "_journal.json"))) {
    throw new Error(`Cannot find migrations in ${folder}. Run commands from the project root.`);
  }
  return folder;
}

/** Apply pending migrations to a Postgres (postgres-js) database. */
export async function migratePostgres(db: Db) {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db as never, { migrationsFolder: migrationsFolder() });
}
