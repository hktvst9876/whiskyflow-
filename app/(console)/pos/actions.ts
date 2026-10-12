"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/core/result";
import { closeVisit } from "@/flows/close-visit";
import { evaluateCheckoutOffer } from "@/flows/checkout-offer";
import { acceptOffer, declineOffer } from "@/flows/issue-anchor";
import { redeemEntitlement } from "@/flows/redemption";
import {
  addItem,
  attachCustomer,
  findCustomer,
  openVisit,
  voidLine,
} from "@/flows/visits";
import { runAction, withAuth } from "@/server/action";

const visitSchema = z.object({
  label: z.string().trim().max(40).optional(),
  partySize: z.coerce.number().int().min(1).max(50),
});

export async function openVisitAction(
  _prev: ActionResult<never> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  return runAction(async () => {
    const input = visitSchema.parse(Object.fromEntries(formData));
    const { db, ctx } = await withAuth("staff");
    const visit = await openVisit(db, ctx, input);
    redirect(`/pos/${visit.id}`);
  });
}

export async function addItemAction(
  visitId: string,
  _prev: ActionResult<{ message: string }> | null,
  formData: FormData,
) {
  return runAction(async () => {
    const input = z
      .object({
        itemId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(20),
      })
      .parse(Object.fromEntries(formData));
    const { db, ctx } = await withAuth("staff");
    await addItem(db, ctx, visitId, input.itemId, input.quantity);
    revalidatePath(`/pos/${visitId}`);
    return { message: "Item added" };
  });
}

export async function attachCustomerAction(
  visitId: string,
  _prev: ActionResult<{ message: string }> | null,
  formData: FormData,
) {
  return runAction(async () => {
    const { query } = z
      .object({ query: z.string().trim().min(4).max(30) })
      .parse(Object.fromEntries(formData));
    const { db, ctx } = await withAuth("staff");
    const customer = await findCustomer(db, ctx, query);
    if (!customer)
      throw new z.ZodError([
        {
          code: "custom",
          path: ["query"],
          message: "No customer matched that phone or wallet code.",
        },
      ]);
    await attachCustomer(db, ctx, visitId, customer.id);
    revalidatePath(`/pos/${visitId}`);
    return { message: "Customer attached" };
  });
}

export async function evaluateOfferAction(visitId: string) {
  return runAction(async () => {
    const { db, ctx } = await withAuth("staff");
    await evaluateCheckoutOffer(db, ctx, visitId);
    revalidatePath(`/pos/${visitId}`);
    return { message: "Decision recorded" };
  });
}

export async function acceptOfferAction(visitId: string, exposureId: string) {
  return runAction(async () => {
    const { db, ctx } = await withAuth("staff");
    await acceptOffer(db, ctx, exposureId);
    revalidatePath(`/pos/${visitId}`);
    return { message: "Return Anchor added to the bill" };
  });
}

export async function declineOfferAction(visitId: string, exposureId: string) {
  return runAction(async () => {
    const { db, ctx } = await withAuth("staff");
    await declineOffer(db, ctx, exposureId);
    revalidatePath(`/pos/${visitId}`);
    return { message: "Offer declined" };
  });
}

export async function redeemAction(visitId: string, entitlementId: string) {
  return runAction(async () => {
    const { db, ctx } = await withAuth("staff");
    await redeemEntitlement(db, ctx, { visitId, entitlementId, quantity: 1 });
    revalidatePath(`/pos/${visitId}`);
    return { message: "Return Anchor redeemed" };
  });
}

export async function voidLineAction(visitId: string, lineId: string) {
  return runAction(async () => {
    const { db, ctx } = await withAuth("staff");
    await voidLine(db, ctx, visitId, lineId);
    revalidatePath(`/pos/${visitId}`);
    return { message: "Line removed" };
  });
}

export async function closeVisitAction(visitId: string) {
  return runAction(async () => {
    const { db, ctx } = await withAuth("staff");
    const summary = await closeVisit(db, ctx, visitId);
    revalidatePath("/pos");
    return { message: summary.headline };
  });
}
