"use server";

import { revalidatePath } from "next/cache";
import { env } from "@/config/env";
import { ForbiddenError } from "@/core/errors";
import { runSchedulerTick } from "@/flows/scheduler";
import { advanceClock, getNow } from "@/server/clock";
import { runAction, withAuth } from "@/server/action";

const HALF_DAY = 0.5;

/**
 * Demo time travel. The clock moves in half-day steps with a scheduler tick at each, so
 * reminders go out when they fall due (and at least one tick per day lands outside quiet
 * hours) instead of being judged days late after one big jump.
 */
export async function advanceDemoClockAction(days: number) {
  return runAction(async () => {
    if (!env().demoMode) throw new ForbiddenError("Time travel is only available in demo mode.");
    const { db } = await withAuth("manager");
    const steps = Math.min(60, Math.max(1, Math.round(days / HALF_DAY)));
    let sent = 0;
    for (let i = 0; i < steps; i++) {
      const now = await advanceClock(db, HALF_DAY);
      sent += (await runSchedulerTick(db, now)).messages.sent;
    }
    revalidatePath("/", "layout");
    return { message: `Moved ${days} day${days === 1 ? "" : "s"} ahead · ${sent} message${sent === 1 ? "" : "s"} sent` };
  });
}

/** Run one scheduler tick now (what the cron endpoint does every few minutes). */
export async function runSchedulerNowAction() {
  return runAction(async () => {
    const { db } = await withAuth("manager");
    const summary = await runSchedulerTick(db, await getNow(db));
    revalidatePath("/", "layout");
    const m = summary.messages;
    return {
      message: `Scheduler ran · ${m.sent} sent, ${m.deferred} waiting (quiet hours or caps), ${m.suppressed} not sent · ${summary.expiredAnchors} anchors expired`,
    };
  });
}
