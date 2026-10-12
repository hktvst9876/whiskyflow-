import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { State, Customer } from "./types";

export function normalizePhone(input: string) {
  const value = input.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(value))
    throw new Error(
      "Enter an international phone number, for example +65 8123 4567.",
    );
  return value;
}
export const digest = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value).digest("hex");
export function matchesDigest(secret: string, value: string, expected: string) {
  const actual = Buffer.from(digest(secret, value)),
    stored = Buffer.from(expected);
  return actual.length === stored.length && timingSafeEqual(actual, stored);
}
export function ensureMember(state: State, authUserId: string): Customer {
  let customer = state.customers.find((c) => c.authUserId === authUserId);
  if (customer) return customer;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let membershipId: string;
  do {
    membershipId =
      "TP-" +
      Array.from(
        { length: 10 },
        () => alphabet[randomInt(alphabet.length)],
      ).join("");
  } while (state.customers.some((c) => c.membershipId === membershipId));
  customer = {
    id: randomUUID(),
    authUserId,
    membershipId,
    createdAt: new Date().toISOString(),
    optedIn: false,
    preferences: [],
    entitlement: false,
  };
  state.customers.push(customer);
  return customer;
}
export function confirmMemberCheckin(
  state: State,
  sessionId: string,
  code: string,
  key: string,
  actor: string,
  now = Date.now(),
) {
  const session = state.sessions.find((s) => s.id === sessionId && !s.closedAt);
  if (!session) return { ok: false, reasons: ["This table visit has ended."] };
  const entries = (state.memberCheckins ?? []).filter(
    (c) =>
      c.sessionId === sessionId &&
      !c.consumedAt &&
      Date.parse(c.expiresAt) > now,
  );
  const failed = state.audits.filter(
    (a) =>
      a.action === "Member check-in rejected" &&
      a.sessionId === sessionId &&
      now - Date.parse(a.createdAt) < 300000,
  ).length;
  const checkin = entries.find((c) =>
    matchesDigest(key, `checkin:${c.id}:${code}`, c.codeHash),
  );
  const customer =
    checkin && state.customers.find((c) => c.id === checkin.customerId);
  const error =
    failed >= 5
      ? "Too many failed check-ins. Retry after five minutes."
      : !checkin || !customer
        ? "Code is invalid or expired for this table."
        : session.customerVerified && session.customerId !== customer.id
          ? "A different verified customer is already linked. Ask the manager to reconcile the POS account."
          : session.offerReceived && session.customerId !== customer.id
            ? "The reward recipient cannot change after a reward was allocated."
            : undefined;
  state.audits.push({
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    actor,
    sessionId,
    action: error ? "Member check-in rejected" : "Member check-in confirmed",
    detail: error ?? `Confirmed ${customer!.membershipId} at the current table`,
  });
  if (error) return { ok: false, reasons: [error] };
  checkin!.consumedAt = new Date(now).toISOString();
  session.customerId = customer!.id;
  session.customerVerified = true;
  // Identity linking never creates a reward or resets an existing opportunity.
  return { ok: true, membershipId: customer!.membershipId };
}
