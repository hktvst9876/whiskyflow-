/**
 * Canonical POS order: the one shape every POS adapter converts to. Money in cents.
 * POST it to /api/v1/pos/orders with `Authorization: Bearer <api key>`.
 * Re-sending the same `externalRef` updates the visit (idempotent).
 */
import { z } from "zod";

export const canonicalLineSchema = z.object({
  /** POS item code; matched to catalog items by SKU first, then by name. */
  sku: z.string().max(80).optional(),
  name: z.string().min(1).max(120),
  category: z.string().max(60).optional(),
  quantity: z.number().int().min(1).max(999),
  unitPriceCents: z.number().int().min(0),
  /** Optional; when omitted the catalog cost is used (or 0 for unknown items). */
  unitCostCents: z.number().int().min(0).optional(),
});

export const canonicalOrderSchema = z.object({
  externalRef: z.string().min(1).max(100),
  status: z.enum(["open", "closed", "voided"]).default("open"),
  openedAt: z.coerce.date().optional(),
  closedAt: z.coerce.date().optional(),
  partySize: z.number().int().min(1).max(50).default(1),
  label: z.string().max(40).optional(),
  /** Identify the customer at the till: phone (E.164 or local) or wallet redeem code. */
  customer: z
    .object({ phone: z.string().max(30).optional(), redeemCode: z.string().max(20).optional() })
    .optional(),
  lines: z.array(canonicalLineSchema).max(200),
  /** Ask the deal engine for a checkout offer and return it in the response. */
  evaluateOffer: z.boolean().default(true),
});

export type CanonicalOrder = z.infer<typeof canonicalOrderSchema>;
export type CanonicalLine = z.infer<typeof canonicalLineSchema>;
