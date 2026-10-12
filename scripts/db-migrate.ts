/**
 * Apply migrations. Postgres (DATABASE_URL) is migrated explicitly — run this on every
 * deploy. The embedded PGlite database migrates itself on first use.
 *   pnpm db:migrate
 */
import { closeDb, getDb } from "@/server/db";
import { migratePostgres } from "@/server/migrate";
import { env } from "@/config/env";

async function main() {
  const db = await getDb();
  if (env().databaseUrl) await migratePostgres(db);
  console.log(env().databaseUrl ? "Postgres migrated." : "Embedded PGlite database is migrated.");
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
