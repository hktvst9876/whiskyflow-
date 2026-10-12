import "server-only";
import { and, eq } from "drizzle-orm";
import { ConflictError, ValidationError } from "@/core/errors";
import { newId } from "@/core/ids";
import { derivedToken, sha256 } from "@/server/crypto";
import type { Db } from "@/server/db";
import { writeAudit } from "../audit/service";
import { toEntitlement, type EntitlementRecord } from "./repo";
import { entitlementEvents, entitlements } from "./schema";
import type { ActorType, AnchorIssueMode, AnchorUnitType, EntitlementStatus, LedgerChange, TermsSnapshot } from "./types";

/**
 * Ledger service: the only code that writes entitlements and their events. Callers lock
 * the entitlement row (`getEntitlement(..., { forUpdate: true })`) inside a transaction
 * before calling `applyLedgerChange`, and the update re-checks `version` as a second guard.
 */

export interface Actor {
  type: ActorType;
  id: string | null;
}

export interface IssueInput {
  merchantId: string;
  customerId: string | null;
  programId: string | null;
  originVisitId: string | null;
  itemId: string | null;
  issueMode: AnchorIssueMode;
  displayName: string;
  unitType: AnchorUnitType;
  unitLabel: string;
  unitLabelPlural: string;
  quantity: number;
  coveredCategory: string | null;
  maxCoveredPriceCents: number | null;
  unitRetailCents: number;
  unitCostCents: number;
  pricePaidCents: number;
  storageLocation: string | null;
  expiresAt: Date | null;
  transferable: boolean;
  termsSnapshot: TermsSnapshot;
  /** Hours the claim link stays valid when the customer is not yet known. */
  claimWindowHours: number;
  actor: Actor;
  at: Date;
}

/** The claim link token for a pending anchor (deterministic from its id). */
export function claimTokenFor(entitlementId: string): string {
  return derivedToken("claim", entitlementId);
}

export async function issueEntitlement(db: Db, input: IssueInput): Promise<{ entitlement: EntitlementRecord; claimToken: string | null }> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new ValidationError("Quantity must be at least 1.");
  const id = newId();
  const status: EntitlementStatus = input.customerId ? "active" : "pending_claim";
  const claimToken = status === "pending_claim" ? claimTokenFor(id) : null;
  const [row] = await db
    .insert(entitlements)
    .values({
      id,
      merchantId: input.merchantId,
      customerId: input.customerId,
      programId: input.programId,
      originVisitId: input.originVisitId,
      itemId: input.itemId,
      issueMode: input.issueMode,
      displayName: input.displayName,
      unitType: input.unitType,
      unitLabel: input.unitLabel,
      unitLabelPlural: input.unitLabelPlural,
      quantityInitial: input.quantity,
      quantityRemaining: input.quantity,
      coveredCategory: input.coveredCategory,
      maxCoveredPriceCents: input.maxCoveredPriceCents,
      unitRetailCents: input.unitRetailCents,
      unitCostCents: input.unitCostCents,
      pricePaidCents: input.pricePaidCents,
      storageLocation: input.storageLocation,
      expiresAt: input.expiresAt,
      transferable: input.transferable,
      termsSnapshot: input.termsSnapshot,
      status,
      claimTokenHash: claimToken ? sha256(claimToken) : null,
      claimExpiresAt: claimToken ? new Date(input.at.getTime() + input.claimWindowHours * 3_600_000) : null,
      issuedByUserId: input.actor.type === "user" || input.actor.type === "staff" ? input.actor.id : null,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .returning();
  await db.insert(entitlementEvents).values({
    merchantId: input.merchantId,
    entitlementId: id,
    type: "issued",
    quantityDelta: input.quantity,
    quantityAfter: input.quantity,
    visitId: input.originVisitId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    note: input.issueMode === "stored_purchase" ? "Stored purchase" : null,
    createdAt: input.at,
  });
  await writeAudit(db, {
    merchantId: input.merchantId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    action: "entitlement.issued",
    entityType: "entitlement",
    entityId: id,
    data: { quantity: input.quantity, pricePaidCents: input.pricePaidCents, issueMode: input.issueMode },
    at: input.at,
  });
  return { entitlement: toEntitlement(row!), claimToken };
}

/** Apply a validated ledger change to a LOCKED entitlement row. */
export async function applyLedgerChange(
  db: Db,
  current: EntitlementRecord,
  change: LedgerChange,
  meta: { visitId: string | null; actor: Actor; at: Date; auditAction?: string },
): Promise<EntitlementRecord> {
  const [row] = await db
    .update(entitlements)
    .set({
      quantityRemaining: change.quantityAfter,
      status: change.statusAfter,
      version: current.version + 1,
      updatedAt: meta.at,
    })
    .where(and(eq(entitlements.id, current.id), eq(entitlements.version, current.version)))
    .returning();
  if (!row) throw new ConflictError("This anchor changed while you were working. Please refresh.");
  await db.insert(entitlementEvents).values({
    merchantId: current.merchantId,
    entitlementId: current.id,
    type: change.event.type,
    quantityDelta: change.event.quantityDelta,
    quantityAfter: change.event.quantityAfter,
    visitId: meta.visitId,
    actorType: meta.actor.type,
    actorId: meta.actor.id,
    note: change.event.note,
    createdAt: meta.at,
  });
  await writeAudit(db, {
    merchantId: current.merchantId,
    actorType: meta.actor.type,
    actorId: meta.actor.id,
    action: meta.auditAction ?? `entitlement.${change.event.type}`,
    entityType: "entitlement",
    entityId: current.id,
    data: { delta: change.event.quantityDelta, after: change.quantityAfter, status: change.statusAfter, note: change.event.note },
    at: meta.at,
  });
  return toEntitlement(row);
}

/** Attach a pending anchor to its owner. The claim link stops working immediately. */
export async function claimEntitlementRow(
  db: Db,
  current: EntitlementRecord,
  customerId: string,
  meta: { actor: Actor; at: Date; via: "claim_page" | "staff" },
): Promise<EntitlementRecord> {
  if (current.status !== "pending_claim") throw new ValidationError("This anchor has already been claimed.");
  const [row] = await db
    .update(entitlements)
    .set({ customerId, status: "active", claimTokenHash: null, claimExpiresAt: null, version: current.version + 1, updatedAt: meta.at })
    .where(and(eq(entitlements.id, current.id), eq(entitlements.version, current.version)))
    .returning();
  if (!row) throw new ConflictError("This anchor changed while you were working. Please refresh.");
  await db.insert(entitlementEvents).values({
    merchantId: current.merchantId,
    entitlementId: current.id,
    type: "claimed",
    quantityDelta: 0,
    quantityAfter: current.quantityRemaining,
    visitId: current.originVisitId,
    actorType: meta.actor.type,
    actorId: meta.actor.id,
    note: meta.via === "staff" ? "Claimed by staff" : null,
    createdAt: meta.at,
  });
  await writeAudit(db, {
    merchantId: current.merchantId,
    actorType: meta.actor.type,
    actorId: meta.actor.id,
    action: "entitlement.claimed",
    entityType: "entitlement",
    entityId: current.id,
    data: { via: meta.via },
    at: meta.at,
  });
  return toEntitlement(row);
}

/** Re-open the claim window (e.g. staff re-shows the QR). Same deterministic token. */
export async function reopenClaimWindow(db: Db, current: EntitlementRecord, hours: number, at: Date): Promise<string> {
  if (current.status !== "pending_claim") throw new ValidationError("This anchor has already been claimed.");
  const token = claimTokenFor(current.id);
  await db
    .update(entitlements)
    .set({ claimTokenHash: sha256(token), claimExpiresAt: new Date(at.getTime() + hours * 3_600_000), updatedAt: at })
    .where(eq(entitlements.id, current.id));
  return token;
}
