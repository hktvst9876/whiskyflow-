/**
 * POS adapters convert vendor payloads into the canonical order. MVP ships the generic
 * adapter (already canonical). Vendor adapters (Square, Lightspeed, Toast, local SG POS)
 * are Phase 2: add a file exporting a `PosAdapter` and register it in `ADAPTERS`.
 */
import { canonicalOrderSchema, type CanonicalOrder } from "./canonical";

export interface PosAdapter {
  key: string;
  label: string;
  /** Throws a ZodError (→ 400) when the payload is invalid. */
  toCanonical(payload: unknown): CanonicalOrder;
}

export const genericAdapter: PosAdapter = {
  key: "generic",
  label: "Generic (canonical JSON)",
  toCanonical: (payload) => canonicalOrderSchema.parse(payload),
};

export const ADAPTERS: Record<string, PosAdapter> = { generic: genericAdapter };

export function getPosAdapter(key: string | null | undefined): PosAdapter {
  return ADAPTERS[key ?? "generic"] ?? genericAdapter;
}
