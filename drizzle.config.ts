import { defineConfig } from "drizzle-kit";

/**
 * `pnpm db:generate` diffs the module schema files against the last snapshot in
 * `drizzle/` and writes a new SQL migration. Never edit generated SQL by hand.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/modules/*/schema.ts",
  out: "./drizzle",
});
