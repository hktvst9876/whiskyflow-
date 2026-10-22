import "server-only";
import { z } from "zod";
import { logger } from "@/core/logger";

/**
 * Validated environment. Read through `env()` (lazy, cached) so scripts and tests can set
 * `process.env` before first use. Every variable is documented in `.env.example`.
 */

const DEV_SECRET = "dev-only-insecure-secret-change-me-0123456789";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : v === "true" || v === "1"));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Postgres connection string. When unset the app uses an embedded PGlite database. */
  DATABASE_URL: z.string().optional(),
  /** Where the embedded PGlite database lives ("memory://" for an in-memory database). */
  PGLITE_DATA_DIR: z.string().default(".demo/pglite"),
  /** Public base URL used in QR codes and WhatsApp links. */
  APP_URL: z.string().url().default("http://127.0.0.1:3210"),
  /** Secret for session/claim/wallet token derivation (32+ chars). Required in production. */
  APP_SECRET: z.string().min(32).optional(),
  /** Enables demo merchants, demo accounts, time travel and the demo WhatsApp inbox. */
  DEMO_MODE: bool,
  /** Seed demo data automatically on first start of an empty embedded database. */
  AUTO_SEED: bool,
  /** Shared secret for /api/cron/tick (send as `Authorization: Bearer <secret>`). */
  CRON_SECRET: z.string().min(16).optional(),
  WHATSAPP_PROVIDER: z.enum(["demo", "console", "meta"]).default("demo"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  /** Meta app secret used to verify `X-Hub-Signature-256` on webhooks. */
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default("v25.0"),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("en"),
});

export interface Env {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  databaseUrl: string | null;
  pgliteDataDir: string;
  appUrl: string;
  appSecret: string;
  demoMode: boolean;
  autoSeed: boolean;
  cronSecret: string | null;
  whatsapp: {
    provider: "demo" | "console" | "meta";
    phoneNumberId: string | null;
    accessToken: string | null;
    appSecret: string | null;
    verifyToken: string | null;
    apiVersion: string;
    templateLanguage: string;
  };
}

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === "production";
  if (isProduction && !e.APP_SECRET) throw new Error("APP_SECRET (32+ characters) is required in production.");
  if (!e.APP_SECRET && e.NODE_ENV === "development") {
    logger.warn("APP_SECRET is not set; using an insecure development secret.");
  }
  const demoMode = e.DEMO_MODE ?? !isProduction;
  cached = {
    nodeEnv: e.NODE_ENV,
    isProduction,
    databaseUrl: e.DATABASE_URL || null,
    pgliteDataDir: e.PGLITE_DATA_DIR,
    appUrl: e.APP_URL.replace(/\/+$/, ""),
    appSecret: e.APP_SECRET ?? DEV_SECRET,
    demoMode,
    autoSeed: e.AUTO_SEED ?? (demoMode && !e.DATABASE_URL),
    cronSecret: e.CRON_SECRET ?? null,
    whatsapp: {
      provider: e.WHATSAPP_PROVIDER,
      phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID ?? null,
      accessToken: e.WHATSAPP_ACCESS_TOKEN ?? null,
      appSecret: e.WHATSAPP_APP_SECRET ?? null,
      verifyToken: e.WHATSAPP_VERIFY_TOKEN ?? null,
      apiVersion: e.WHATSAPP_API_VERSION,
      templateLanguage: e.WHATSAPP_TEMPLATE_LANGUAGE,
    },
  };
  return cached;
}

/** Tests and scripts that change process.env after first use call this. */
export function resetEnvCache() {
  cached = null;
}
