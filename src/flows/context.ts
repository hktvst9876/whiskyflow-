import "server-only";
import { ForbiddenError } from "@/core/errors";
import { env } from "@/config/env";
import type { Db } from "@/server/db";
import type { Actor } from "@/modules/anchors/service";
import { loadMerchantContext, type MerchantContext } from "@/modules/merchants/repo";

/**
 * Every flow receives the merchant it acts for, who is acting and the instant to use as
 * "now". Flows never read the system clock themselves: server actions pass `getNow(db)`
 * (demo-clock aware) and the demo simulation passes its simulated time.
 */
export interface FlowContext {
  merchantId: string;
  actor: Actor;
  now: Date;
}

export const systemActor: Actor = { type: "system", id: null };

/** Load the merchant + effective settings for a flow, failing loudly on tenant mismatch. */
export async function merchantFor(db: Db, ctx: Pick<FlowContext, "merchantId">): Promise<MerchantContext> {
  return loadMerchantContext(db, ctx.merchantId);
}

export function assertSameMerchant(record: { merchantId: string }, ctx: Pick<FlowContext, "merchantId">) {
  if (record.merchantId !== ctx.merchantId) throw new ForbiddenError("That record belongs to another business.");
}

/** Public URL of the customer wallet for a wallet token. */
export function walletUrl(token: string): string {
  return `${env().appUrl}/w/${token}`;
}

/** Public URL of the claim page for a claim token. */
export function claimUrl(token: string): string {
  return `${env().appUrl}/c/${token}`;
}

/** Is `now` inside one of the merchant's blackout date ranges (local dates)? */
export function blackoutReason(
  blackouts: { start: string; end: string; reason: string }[],
  now: Date,
  timeZone: string,
): string | null {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const hit = blackouts.find((b) => b.start <= local && local <= b.end);
  return hit ? hit.reason || "Blackout period" : null;
}
