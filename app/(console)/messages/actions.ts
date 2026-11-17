"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { env } from "@/config/env";
import { ForbiddenError, ValidationError } from "@/core/errors";
import type { ActionResult } from "@/core/result";
import { randomToken } from "@/core/ids";
import { handleInboundText } from "@/flows/inbound-message";
import { getCustomer } from "@/modules/customers/repo";
import { runAction, withAuth } from "@/server/action";

/**
 * Demo phone: send a WhatsApp text AS a demo customer (STOP, START, "balance?") to see
 * how the app answers. Demo mode only; real inbound texts arrive through the webhook.
 */
export async function demoInboundAction(
  customerId: string,
  _prev: ActionResult<{ message: string }> | null,
  formData: FormData,
) {
  return runAction(async () => {
    if (!env().demoMode) throw new ForbiddenError("The demo phone is only available in demo mode.");
    const { text } = z.object({ text: z.string().trim().min(1, "Type a message.").max(500) }).parse(Object.fromEntries(formData));
    const { db, ctx } = await withAuth("manager");
    const customer = await getCustomer(db, ctx.merchantId, z.string().uuid().parse(customerId));
    if (!customer.phoneE164) throw new ValidationError("This customer has no phone number.");
    const result = await handleInboundText(db, {
      fromPhone: customer.phoneE164,
      text,
      providerMessageId: `demo.in.${randomToken(9)}`,
      now: ctx.now,
      merchantId: ctx.merchantId,
    });
    revalidatePath("/messages");
    return { message: result.intent === "opt_out" ? "Opted out. No more messages will be sent." : result.intent === "opt_in" ? "Opted back in." : "Balance reply sent." };
  });
}
