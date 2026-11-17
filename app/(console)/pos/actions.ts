"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/core/result";
import { claimByStaff } from "@/flows/claim-anchor";
import { closeVisit } from "@/flows/close-visit";
import { evaluateCheckoutOffer } from "@/flows/checkout-offer";
import {
  acceptOffer,
  declineOffer,
  keepStoredPurchase,
} from "@/flows/issue-anchor";
import {
  addUpsell,
  recordBottleLevel,
  redeemEntitlement,
} from "@/flows/redemption";
import {
  addItem,
  applyCustomerPromo,
  attachCustomer,
  createCustomerAtTill,
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

const id = z.string().uuid();

export async function quickAddAction(visitId: string, itemId: string) {
  return runAction(async () => {
    const { db, ctx } = await withAuth("staff");
    const line = await addItem(db, ctx, id.parse(visitId), id.parse(itemId), 1);
    revalidatePath(`/pos/${visitId}`);
    return { message: `${line.name} added` };
  });
}

/** New guest at the till: a profile by phone. Messaging still needs their consent. */
export async function createCustomerAction(
  visitId: string,
  _prev: ActionResult<{ message: string }> | null,
  formData: FormData,
) {
  return runAction(async () => {
    const input = z
      .object({
        phone: z.string().trim().min(6, "Enter their mobile number."),
        name: z.string().trim().max(80).optional(),
      })
      .parse(Object.fromEntries(formData));
    const { db, ctx } = await withAuth("staff");
    const customer = await createCustomerAtTill(db, ctx, input);
    await attachCustomer(db, ctx, id.parse(visitId), customer.id);
    revalidatePath(`/pos/${visitId}`);
    return { message: "Customer added to the bill" };
  });
}

export async function redeemAction(
  visitId: string,
  entitlementId: string,
  _prev: ActionResult<{ message: string }> | null,
  formData: FormData,
) {
  return runAction(async () => {
    const input = z
      .object({
        itemId: z.union([z.literal(""), id]).optional(),
        quantity: z.coerce.number().int().min(1).max(100).default(1),
      })
      .parse(Object.fromEntries(formData));
    const { db, ctx } = await withAuth("staff");
    const result = await redeemEntitlement(db, ctx, {
      visitId: id.parse(visitId),
      entitlementId: id.parse(entitlementId),
      quantity: input.quantity,
      itemId: input.itemId || null,
    });
    revalidatePath(`/pos/${visitId}`);
    return {
      message:
        result.entitlement.quantityRemaining > 0
          ? `Redeemed · ${result.label}`
          : "Redeemed · nothing left on this anchor",
    };
  });
}

/** Bottle keep: record the level after pouring (levels only go down). */
export async function recordLevelAction(
  visitId: string,
  entitlementId: string,
  _prev: ActionResult<{ message: string }> | null,
  formData: FormData,
) {
  return runAction(async () => {
    const { percent } = z
      .object({ percent: z.coerce.number().int().min(0).max(100) })
      .parse(Object.fromEntries(formData));
    const { db, ctx } = await withAuth("staff");
    const result = await recordBottleLevel(db, ctx, {
      visitId: id.parse(visitId),
      entitlementId: id.parse(entitlementId),
      percent,
    });
    revalidatePath(`/pos/${visitId}`);
    return { message: `Level recorded · ${result.label}` };
  });
}

/** The guest leaves part of something they bought (bottle, bucket, package). */
export async function keepAction(
  visitId: string,
  lineId: string,
  programId: string,
  _prev: ActionResult<{ message: string }> | null,
  formData: FormData,
) {
  return runAction(async () => {
    const input = z
      .object({
        quantity: z.coerce.number().int().min(1).max(100),
        storageLocation: z.string().trim().max(40).optional(),
      })
      .parse(Object.fromEntries(formData));
    const { db, ctx } = await withAuth("staff");
    const kept = await keepStoredPurchase(db, ctx, {
      visitId: id.parse(visitId),
      lineId: id.parse(lineId),
      programId: id.parse(programId),
      ...input,
    });
    revalidatePath(`/pos/${visitId}`);
    return {
      message: kept.claimUrl
        ? "Kept. Show the guest the QR to put it in their wallet."
        : "Kept and added to the guest's wallet",
    };
  });
}

/**
 * Claim for a guest who gives their number at the counter instead of scanning the QR.
 * Staff must read the consent line aloud; marketing stays off unless the guest says yes.
 */
export async function claimByPhoneAction(
  visitId: string,
  entitlementId: string,
  _prev: ActionResult<{ message: string }> | null,
  formData: FormData,
) {
  return runAction(async () => {
    const input = z
      .object({
        phone: z.string().trim().min(6, "Enter their mobile number."),
        name: z.string().trim().max(80).optional(),
      })
      .parse(Object.fromEntries(formData));
    if (formData.get("consentRead") !== "on")
      throw new z.ZodError([
        {
          code: "custom",
          path: ["consentRead"],
          message: "Read the consent line to the guest first.",
        },
      ]);
    const { db, ctx } = await withAuth("staff");
    await claimByStaff(db, ctx, id.parse(entitlementId), {
      ...input,
      serviceOptIn: true,
      marketingOptIn: formData.get("marketingOptIn") === "on",
    });
    revalidatePath(`/pos/${visitId}`);
    return { message: "Claimed. The wallet link is on its way by WhatsApp." };
  });
}

export async function applyPromoAction(visitId: string, exposureId: string) {
  return runAction(async () => {
    const { db, ctx } = await withAuth("staff");
    await applyCustomerPromo(db, ctx, id.parse(visitId), id.parse(exposureId));
    revalidatePath(`/pos/${visitId}`);
    return { message: "Offer applied to the bill" };
  });
}

/** One tap on a suggested add-on: an item, or a merchant bundle. */
export async function addUpsellAction(
  visitId: string,
  itemId: string | null,
  offerDefinitionId: string | null,
) {
  return runAction(async () => {
    const { db, ctx } = await withAuth("staff");
    const lines = await addUpsell(db, ctx, {
      visitId: id.parse(visitId),
      itemId: itemId ? id.parse(itemId) : null,
      offerDefinitionId: offerDefinitionId ? id.parse(offerDefinitionId) : null,
    });
    revalidatePath(`/pos/${visitId}`);
    return { message: `${lines[0]?.name ?? "Add-on"} added` };
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
    revalidatePath(`/pos/${visitId}`);
    return { message: summary.headline };
  });
}
