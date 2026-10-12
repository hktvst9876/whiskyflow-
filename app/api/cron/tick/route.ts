import { env } from "@/config/env";
import { runSchedulerTick } from "@/flows/scheduler";
import { safeEqual } from "@/server/crypto";
import { getNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { errorResponse } from "@/server/action";

export async function POST(request: Request) {
  try {
    const expected = env().cronSecret;
    const actual =
      request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ??
      "";
    if (!expected || !safeEqual(actual, expected))
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    const db = await getDb();
    return Response.json(await runSchedulerTick(db, await getNow(db)));
  } catch (error) {
    return errorResponse(error);
  }
}
