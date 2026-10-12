import "server-only";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Sql } from "postgres";
import { env } from "@/config/env";
import { logger } from "@/core/logger";
import { migrationsFolder } from "./migrate";

/**
 * Database access. Production uses Postgres via `DATABASE_URL`; development, demos and
 * tests use PGlite (Postgres compiled to WebAssembly) with the same SQL and migrations.
 *
 * `Db` covers both drivers and transactions, so repos take `db: Db` and work inside or
 * outside a transaction. (`DbOrTx` is an alias kept for readability in signatures.)
 */
export type Db = PgDatabase<PgQueryResultHKT>;
export type DbOrTx = Db;

type Client = { kind: "pglite"; pglite: PGlite } | { kind: "postgres"; sql: Sql };

/**
 * The raw client lives on globalThis so dev hot-reloads and separately bundled server
 * entry points (instrumentation, routes) share ONE connection. Two PGlite instances on
 * the same data directory would corrupt it.
 */
const globalStore = globalThis as unknown as { __returnAnchorClient?: Promise<Client> };

let wrapped: { client: Client; db: Db } | null = null;

export async function getDb(): Promise<Db> {
  globalStore.__returnAnchorClient ??= openClient();
  const client = await globalStore.__returnAnchorClient;
  if (wrapped?.client === client) return wrapped.db;
  const db = await wrapClient(client);
  wrapped = { client, db };
  return db;
}

async function wrapClient(client: Client): Promise<Db> {
  if (client.kind === "pglite") {
    const { drizzle } = await import("drizzle-orm/pglite");
    return drizzle(client.pglite) as unknown as Db;
  }
  const { drizzle } = await import("drizzle-orm/postgres-js");
  return drizzle(client.sql) as unknown as Db;
}

async function openClient(): Promise<Client> {
  const e = env();
  if (e.databaseUrl) {
    const { default: postgres } = await import("postgres");
    const sql = postgres(e.databaseUrl, { max: 10, idle_timeout: 30 });
    logger.info("Connected to Postgres");
    return { kind: "postgres", sql };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = e.pgliteDataDir;
  if (!dataDir.startsWith("memory://")) mkdirSync(resolve(dataDir), { recursive: true });
  const pglite = new PGlite(dataDir.startsWith("memory://") ? dataDir : resolve(dataDir));
  await pglite.waitReady;
  // The embedded database migrates itself so `pnpm dev` works with zero setup.
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { drizzle } = await import("drizzle-orm/pglite");
  await migrate(drizzle(pglite), { migrationsFolder: migrationsFolder() });
  logger.info("Embedded PGlite database ready", { dataDir });
  return { kind: "pglite", pglite };
}

/** Close the shared client (scripts only). */
export async function closeDb() {
  const pending = globalStore.__returnAnchorClient;
  globalStore.__returnAnchorClient = undefined;
  wrapped = null;
  if (!pending) return;
  const client = await pending;
  if (client.kind === "pglite") await client.pglite.close();
  else await client.sql.end();
}

/** Run `fn` in a transaction. Nested calls become savepoints. */
export function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(tx as unknown as Db));
}
