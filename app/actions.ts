"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  authenticate,
  endSession,
  startSession,
  switchMerchant,
} from "@/modules/auth/service";
import {
  clearSessionCookie,
  clientKey,
  getAuth,
  readSessionToken,
  setSessionCookie,
  userAgent,
} from "@/modules/auth/session";
import { getDb } from "@/server/db";
import { getNow } from "@/server/clock";
import { homeFor, runAction } from "@/server/action";
import { listMemberships } from "@/modules/auth/repo";
import type { ActionResult } from "@/core/result";

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function loginAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  return runAction(async () => {
    const input = loginSchema.parse(Object.fromEntries(formData));
    const db = await getDb();
    const user = await authenticate(db, {
      ...input,
      clientKey: await clientKey(),
      now: await getNow(db),
    });
    const session = await startSession(db, {
      userId: user.id,
      userAgent: await userAgent(),
      now: new Date(),
    });
    await setSessionCookie(session.token, session.expiresAt);
    // Till staff land on the till; owners and managers on Today.
    const role = (await listMemberships(db, user.id))[0]?.role ?? "staff";
    redirect(homeFor(role));
  });
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) await endSession(await getDb(), token);
  await clearSessionCookie();
  redirect("/login");
}

export async function switchMerchantAction(formData: FormData): Promise<void> {
  const merchantId = z.string().uuid().parse(formData.get("merchantId"));
  const auth = await getAuth();
  if (!auth) redirect("/login");
  await switchMerchant(await getDb(), auth, merchantId);
  const role = auth.memberships.find((m) => m.merchantId === merchantId)?.role ?? "staff";
  redirect(homeFor(role));
}
