import "server-only";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/server/db";
import type { ActorType } from "../anchors/types";
import { auditLog } from "./schema";

export interface AuditEntry {
  merchantId: string | null;
  actorType: ActorType;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data?: Record<string, unknown>;
  at?: Date;
}

/** Append-only. Never store phone numbers, tokens or message bodies in `data`. */
export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    merchantId: entry.merchantId,
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    data: entry.data ?? {},
    ...(entry.at ? { createdAt: entry.at } : {}),
  });
}

export async function listAudit(db: Db, merchantId: string, limit = 100) {
  return db.select().from(auditLog).where(eq(auditLog.merchantId, merchantId)).orderBy(desc(auditLog.createdAt)).limit(limit);
}
