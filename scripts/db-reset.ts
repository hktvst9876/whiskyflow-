/**
 * Wipe the embedded demo database and seed it again. Refuses to touch Postgres
 * (DATABASE_URL) — dropping a real database is never a script default.
 *   pnpm db:reset
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "@/config/env";

async function main() {
  const e = env();
  if (e.databaseUrl) {
    console.error("db:reset only resets the embedded PGlite demo database. Unset DATABASE_URL to use it.");
    process.exit(1);
  }
  if (!e.pgliteDataDir.startsWith("memory://")) {
    rmSync(resolve(e.pgliteDataDir), { recursive: true, force: true });
    console.log(`Removed ${e.pgliteDataDir}.`);
  }
  await import("./db-seed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
