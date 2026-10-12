import "server-only";
import { eq } from "drizzle-orm";
import { env } from "@/config/env";
import { appState } from "@/modules/merchants/schema";
import type { Db } from "./db";

/**
 * The application clock. In demo mode an offset stored in `app_state` lets the console
 * "time travel" (e.g. jump 10 days to see reminders fire). Production uses real time.
 */
const KEY = "demo_clock_offset_ms";
let cache: { offset: number; readAt: number } | null = null;

export async function getClockOffsetMs(db: Db): Promise<number> {
  if (!env().demoMode) return 0;
  if (cache && Date.now() - cache.readAt < 1000) return cache.offset;
  const [row] = await db.select().from(appState).where(eq(appState.key, KEY));
  const offset = typeof row?.value === "number" ? row.value : 0;
  cache = { offset, readAt: Date.now() };
  return offset;
}

export async function getNow(db: Db): Promise<Date> {
  return new Date(Date.now() + (await getClockOffsetMs(db)));
}

export async function setClockOffsetMs(db: Db, offset: number): Promise<void> {
  await db
    .insert(appState)
    .values({ key: KEY, value: offset, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appState.key, set: { value: offset, updatedAt: new Date() } });
  cache = { offset, readAt: Date.now() };
}

export async function advanceClock(db: Db, days: number): Promise<Date> {
  const offset = (await getClockOffsetMs(db)) + Math.round(days * 86_400_000);
  await setClockOffsetMs(db, offset);
  return new Date(Date.now() + offset);
}
