import "server-only";
import { readState } from "./store";
import { demoMode } from "./config";
import { displayToken } from "./tokens";
import type { Role, Snapshot } from "../types";
export async function snapshot(role: Role): Promise<Snapshot> {
  const state = await readState();
  return {
    ...state,
    memberCheckins: [],
    demoOtps: [],
    sessions: state.sessions.map((s) => ({
      ...s,
      membershipId: state.customers.find((c) => c.id === s.customerId)
        ?.membershipId,
    })),
    serverTime: Date.now(),
    customers:
      role === "staff"
        ? []
        : state.customers.map(({ authUserId: _privateIdentity, ...c }) => c),
    history: role === "staff" ? [] : state.history,
    mode: demoMode ? "demo" : "live",
    role,
    displayTokens: Object.fromEntries(
      state.sessions
        .filter((s) => !s.closedAt)
        .map((s) => [
          s.id,
          displayToken(s.id, new Date(s.startedAt).getTime() + 12 * 3600000),
        ]),
    ),
  };
}
