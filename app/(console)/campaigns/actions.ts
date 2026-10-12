"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/core/result";
import { launchCampaign } from "@/flows/campaigns";
import type { CampaignKind } from "@/modules/campaigns/types";
import { runAction, withAuth } from "@/server/action";

export async function launchCampaignAction(
  kind: CampaignKind,
  _prev: ActionResult<{ message: string }> | null,
  _formData: FormData,
) {
  return runAction(async () => {
    const { db, ctx } = await withAuth("manager");
    const campaign = await launchCampaign(db, ctx, kind);
    revalidatePath("/campaigns");
    return { message: `${campaign.name} launched with a measurement holdout.` };
  });
}
