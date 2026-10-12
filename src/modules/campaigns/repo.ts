import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { NotFoundError } from "@/core/errors";
import type { Db } from "@/server/db";
import type { Arm } from "../experiments/types";
import { campaignRecipients, campaigns } from "./schema";
import type { Campaign, CampaignKind, CampaignStatus } from "./types";

const toCampaign = (row: typeof campaigns.$inferSelect): Campaign => ({
  id: row.id,
  merchantId: row.merchantId,
  kind: row.kind,
  name: row.name,
  segment: row.segment as Campaign["segment"],
  offerDefinitionId: row.offerDefinitionId,
  status: row.status,
  holdoutRate: row.holdoutBp / 10_000,
  audienceCount: row.audienceCount,
  expectedCostCents: row.expectedCostCents,
  expectedReturnCents: row.expectedReturnCents,
  scheduledFor: row.scheduledFor,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
});

export async function insertCampaign(
  db: Db,
  input: {
    merchantId: string;
    kind: CampaignKind;
    name: string;
    segment: string;
    offerDefinitionId: string | null;
    status: CampaignStatus;
    holdoutRate: number;
    audienceCount: number;
    expectedCostCents: number;
    expectedReturnCents: number;
    scheduledFor: Date | null;
    createdBy: string | null;
    at: Date;
  },
): Promise<Campaign> {
  const { at, holdoutRate, ...values } = input;
  const [row] = await db
    .insert(campaigns)
    .values({ ...values, holdoutBp: Math.round(holdoutRate * 10_000), createdAt: at })
    .returning();
  return toCampaign(row!);
}

export async function updateCampaign(db: Db, id: string, patch: Partial<Pick<Campaign, "status" | "audienceCount">>) {
  await db.update(campaigns).set(patch).where(eq(campaigns.id, id));
}

export async function listCampaigns(db: Db, merchantId: string) {
  const rows = await db.select().from(campaigns).where(eq(campaigns.merchantId, merchantId)).orderBy(desc(campaigns.createdAt));
  return rows.map(toCampaign);
}

export async function getCampaign(db: Db, merchantId: string, id: string) {
  const [row] = await db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.merchantId, merchantId)));
  if (!row) throw new NotFoundError("Campaign not found.");
  return toCampaign(row);
}

export async function insertRecipient(db: Db, input: { merchantId: string; campaignId: string; customerId: string; arm: Arm; messageId: string | null; at: Date }) {
  await db
    .insert(campaignRecipients)
    .values({ merchantId: input.merchantId, campaignId: input.campaignId, customerId: input.customerId, arm: input.arm, messageId: input.messageId, createdAt: input.at })
    .onConflictDoNothing();
}

export async function listRecipients(db: Db, campaignId: string) {
  return db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaignId));
}
