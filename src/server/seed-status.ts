import "server-only";

/**
 * Status of the background demo seed started by instrumentation.ts, shared through
 * globalThis so every server bundle (pages, actions, routes) sees the same value.
 */
export type SeedStatus = { state: "idle" | "running" | "done" | "error"; progress: number; message: string | null };

const store = globalThis as unknown as { __returnAnchorSeed?: SeedStatus };

export function seedStatus(): SeedStatus {
  return store.__returnAnchorSeed ?? { state: "idle", progress: 0, message: null };
}

export function setSeedStatus(status: SeedStatus) {
  store.__returnAnchorSeed = status;
}
