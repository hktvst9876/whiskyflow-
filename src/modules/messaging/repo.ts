import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { messages } from "./schema";
import type { Message, MessageButton, MessageCategory, MessageStatus, TemplateKey } from "./types";

export const toMessage = (row: typeof messages.$inferSelect): Message => ({ ...row, buttons: row.buttons ?? [] });

export interface NewMessage {
  merchantId: string;
  customerId: string | null;
  direction: "outbound" | "inbound";
  templateKey: TemplateKey | null;
  category: MessageCategory;
  toPhone: string | null;
  body: string;
  variables?: Record<string, string>;
  buttons?: MessageButton[];
  status: MessageStatus;
  scheduledFor: Date;
  dedupeKey?: string | null;
  entitlementId?: string | null;
  campaignId?: string | null;
  offerExposureId?: string | null;
  estCostCents?: number;
  provider?: string | null;
  providerMessageId?: string | null;
  sentAt?: Date | null;
  at: Date;
}

/** Insert a message. Returns null when a message with the same dedupe key already exists. */
export async function insertMessage(db: Db, input: NewMessage): Promise<Message | null> {
  const rows = await db
    .insert(messages)
    .values({
      merchantId: input.merchantId,
      customerId: input.customerId,
      direction: input.direction,
      templateKey: input.templateKey,
      category: input.category,
      toPhone: input.toPhone,
      body: input.body,
      variables: input.variables ?? {},
      buttons: input.buttons ?? [],
      status: input.status,
      scheduledFor: input.scheduledFor,
      dedupeKey: input.dedupeKey ?? null,
      entitlementId: input.entitlementId ?? null,
      campaignId: input.campaignId ?? null,
      offerExposureId: input.offerExposureId ?? null,
      estCostCents: input.estCostCents ?? 0,
      provider: input.provider ?? null,
      providerMessageId: input.providerMessageId ?? null,
      sentAt: input.sentAt ?? null,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .onConflictDoNothing()
    .returning();
  return rows[0] ? toMessage(rows[0]) : null;
}

/**
 * Claim due messages for sending (status → sending). SKIP LOCKED lets several scheduler
 * ticks run concurrently without double-sending.
 */
export async function claimDueMessages(db: Db, now: Date, limit = 100): Promise<Message[]> {
  const due = db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.status, "scheduled"), lte(messages.scheduledFor, now)))
    .orderBy(asc(messages.scheduledFor))
    .limit(limit)
    .for("update", { skipLocked: true });
  const rows = await db.update(messages).set({ status: "sending", updatedAt: now }).where(inArray(messages.id, due)).returning();
  return rows.map(toMessage).sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

export async function updateMessage(
  db: Db,
  id: string,
  patch: Partial<Pick<Message, "status" | "scheduledFor" | "sentAt" | "provider" | "providerMessageId" | "error" | "suppressReason" | "body" | "buttons" | "offerExposureId">> & { at: Date },
) {
  const { at, ...rest } = patch;
  await db.update(messages).set({ ...rest, updatedAt: at }).where(eq(messages.id, id));
}

export async function cancelScheduledForEntitlement(db: Db, entitlementId: string, reason: string, at: Date) {
  await db
    .update(messages)
    .set({ status: "cancelled", suppressReason: reason, updatedAt: at })
    .where(and(eq(messages.entitlementId, entitlementId), eq(messages.status, "scheduled")));
}

/** Marketing messages actually sent to a customer since `since`. */
export async function countMarketingSent(db: Db, customerId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.customerId, customerId),
        eq(messages.category, "marketing"),
        inArray(messages.status, ["sent", "delivered", "read"]),
        gte(messages.sentAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function findMessageByProviderId(db: Db, providerMessageId: string) {
  const [row] = await db.select().from(messages).where(eq(messages.providerMessageId, providerMessageId));
  return row ? toMessage(row) : null;
}

export async function listMessages(db: Db, merchantId: string, options: { customerId?: string; limit?: number; statuses?: MessageStatus[] } = {}) {
  const conditions = [eq(messages.merchantId, merchantId)];
  if (options.customerId) conditions.push(eq(messages.customerId, options.customerId));
  if (options.statuses) conditions.push(inArray(messages.status, options.statuses));
  const rows = await db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.scheduledFor))
    .limit(options.limit ?? 200);
  return rows.map(toMessage);
}

/** Reminder-type messages sent to a customer (for the response-rate feature). */
export async function sentRemindersForCustomer(db: Db, customerId: string) {
  return db
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(
      and(
        eq(messages.customerId, customerId),
        inArray(messages.templateKey, ["anchor_reminder", "anchor_expiry_warning", "anchor_win_back", "campaign_offer"]),
        inArray(messages.status, ["sent", "delivered", "read"]),
      ),
    );
}
