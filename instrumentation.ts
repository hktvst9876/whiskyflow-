/**
 * Runs once when the Next.js server starts. In demo mode with the embedded database
 * (the default for `pnpm dev`), seed the four demo merchants in the background so the
 * app works with zero setup. Pages stay usable; the login page shows progress.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/config/env");
  if (!env().autoSeed) return;
  const { getDb } = await import("@/server/db");
  const { getNow } = await import("@/server/clock");
  const { demoSeeded, seedDemo } = await import("@/flows/demo");
  const { seedStatus, setSeedStatus } = await import("@/server/seed-status");
  const { logger } = await import("@/core/logger");
  if (seedStatus().state === "running") return;
  void (async () => {
    try {
      const db = await getDb();
      if (await demoSeeded(db)) {
        setSeedStatus({ state: "done", progress: 1, message: null });
        return;
      }
      setSeedStatus({ state: "running", progress: 0, message: "Preparing demo data…" });
      logger.info("Seeding demo data in the background");
      const summary = await seedDemo(db, {
        now: await getNow(db),
        days: Number(process.env.DEMO_DAYS ?? 35),
        scale: Number(process.env.DEMO_SCALE ?? 0.5),
        onProgress: (p) => setSeedStatus({ state: "running", progress: p, message: "Preparing demo data…" }),
      });
      setSeedStatus({ state: "done", progress: 1, message: null });
      logger.info("Demo data ready", { ms: summary?.ms ?? 0 });
    } catch (error) {
      setSeedStatus({ state: "error", progress: 0, message: error instanceof Error ? error.message : String(error) });
      logger.error("Demo seed failed", { error: String(error) });
    }
  })();
}
