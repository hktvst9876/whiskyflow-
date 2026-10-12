"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/core/result";
import { claimByToken } from "@/flows/claim-anchor";
import { clientKey } from "@/modules/auth/session";
import { runAction } from "@/server/action";
import { getNow } from "@/server/clock";
import { getDb } from "@/server/db";

export async function claimAction(
  token: string,
  _prev: ActionResult<never> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  return runAction(async () => {
    const input = z
      .object({
        phone: z.string().trim().min(6),
        name: z.string().trim().max(80).optional(),
      })
      .parse(Object.fromEntries(formData));
    const db = await getDb();
    const result = await claimByToken(db, token, {
      ...input,
      serviceOptIn: formData.get("serviceOptIn") === "on",
      marketingOptIn: formData.get("marketingOptIn") === "on",
      clientKey: await clientKey(),
      now: await getNow(db),
    });
    redirect(result.walletUrl);
  });
}
