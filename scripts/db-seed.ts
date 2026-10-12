/**
 * Seed the demo: four merchants (restaurant, bar, beer pub, spa) with ~6 weeks of
 * simulated customers driven through the real flows. Skips when merchants exist.
 *   pnpm db:seed            DEMO_DAYS=35 DEMO_SCALE=0.5 by default
 */
import { closeDb, getDb } from "@/server/db";
import { migratePostgres } from "@/server/migrate";
import { getNow } from "@/server/clock";
import { env } from "@/config/env";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seedDemo } from "@/flows/demo";

async function main() {
  const db = await getDb();
  if (env().databaseUrl) await migratePostgres(db);
  const now = await getNow(db);
  const summary = await seedDemo(db, {
    now,
    days: Number(process.env.DEMO_DAYS ?? 35),
    scale: Number(process.env.DEMO_SCALE ?? 0.5),
  });
  if (!summary) console.log("Database already has merchants — nothing to seed. Use `pnpm db:reset` for a fresh demo.");
  else {
    console.table(summary.merchants);
    console.log(`Seeded in ${(summary.ms / 1000).toFixed(1)}s. Sign in as ${DEMO_ACCOUNTS.owner.email} / ${DEMO_PASSWORD} (owner) or ${DEMO_ACCOUNTS.staff.email} / ${DEMO_PASSWORD} (staff).`);
  }
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
