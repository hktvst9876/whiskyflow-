import "server-only";
import { z } from "zod";
import { randomUUID, randomInt, createHmac } from "node:crypto";
import { demoMode, secret } from "./config";
import { transact } from "./store";
import { HttpError } from "./auth";
import {
  evaluate,
  redeem,
  currentOrders,
  invalidateActiveRewards,
  type OfferRecommendation,
} from "../engine";
import { eventSchema, type PosOrderEvent } from "../pos/adapter";
import type { State } from "../types";
import { confirmMemberCheckin } from "../member-core";
const id = z.uuid();
export const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("order"), event: eventSchema }),
  z.object({
    action: z.literal("confirm_member"),
    sessionId: id,
    code: z.string().regex(/^\d{6}$/),
  }),
  z.object({
    action: z.literal("link_customer"),
    sessionId: id,
    customerRef: z.string().trim().min(3).max(128),
  }),
  z.object({
    action: z.literal("redeem"),
    sessionId: id,
    code: z.string().min(1).max(12),
  }),
  z.object({ action: z.literal("session"), tableId: id }),
  z.object({
    action: z.literal("flags"),
    sessionId: id,
    ageVerified: z.boolean(),
    intoxicated: z.boolean(),
    blocked: z.boolean(),
  }),
  z.object({ action: z.literal("close"), sessionId: id }),
  z.object({
    action: z.literal("cancel"),
    instanceId: id,
    reason: z.string().min(3).max(300),
  }),
  z.object({ action: z.literal("void"), orderId: id }),
  z.object({
    action: z.literal("override"),
    sessionId: id,
    offerId: id,
    reason: z.string().min(3).max(300),
  }),
  z.object({
    action: z.literal("settings"),
    settings: z.object({
      minProfit: z.number().min(0).max(100),
      minMarginPercent: z.number().min(0).max(95),
      minScore: z.number().min(0).max(100),
      allocationProbability: z.number().min(0.05).max(0.95),
      controlPercent: z.number().min(5).max(50),
      paused: z.boolean(),
    }),
  }),
  z.object({
    action: z.literal("offer"),
    offerId: id,
    price: z.number().min(0).max(500).multipleOf(0.01),
    dailyCap: z.number().int().min(0).max(500),
    priority: z.number().min(0).max(100),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("stock"),
    menuItemId: id,
    stock: z.number().int().min(0).max(10000),
    cost: z.number().min(0).max(1000).multipleOf(0.01),
    promotionEligible: z.boolean(),
  }),
  z.object({ action: z.literal("optout"), customerId: id }),
]);
function requireSession(state: State, id: string) {
  const session = state.sessions.find((s) => s.id === id && !s.closedAt);
  if (!session)
    throw new HttpError(409, "This table session is no longer open");
  return session;
}
function linkCustomer(state: State, sessionId: string, reference: string) {
  const session = requireSession(state, sessionId),
    hex = createHmac("sha256", secret("TABLEPULSE_CUSTOMER_SECRET"))
      .update(`customer:v1:${state.venue.id}:${reference.trim()}`)
      .digest("hex"),
    customerId = reference.startsWith("member:")
      ? state.customers.find(
          (c) => c.membershipId === reference.slice(7).trim().toUpperCase(),
        )?.id
      : `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  if (!customerId) throw new HttpError(404, "Membership reference not found");
  if (session.customerVerified && session.customerId !== customerId)
    throw new HttpError(
      409,
      "A verified customer cannot be changed during the visit",
    );
  let customer = state.customers.find((c) => c.id === customerId);
  if (!customer) {
    customer = {
      id: customerId,
      optedIn: false,
      preferences: [],
      entitlement: false,
    };
    state.customers.push(customer);
  }
  session.customerId = customerId;
  session.customerVerified = true;
}
export function ingestOrder(
  state: State,
  event: PosOrderEvent,
  options: {
    recommendation?: OfferRecommendation;
    skipEvaluation?: boolean;
  } = {},
) {
  const existing = state.orders.find((o) => o.externalId === event.externalId);
  if (existing) {
    if (
      existing.sessionId !== event.sessionId ||
      existing.discount !== event.discount ||
      JSON.stringify(existing.items) !== JSON.stringify(event.items)
    )
      throw new HttpError(
        409,
        "This event ID was already used for a different order",
      );
    return { ok: true, duplicate: true, orderId: existing.id };
  }
  const session = requireSession(state, event.sessionId);
  if (event.customerRef) linkCustomer(state, session.id, event.customerRef);
  const totals = new Map<string, number>();
  event.items.forEach((i) =>
    totals.set(i.menuItemId, (totals.get(i.menuItemId) ?? 0) + i.quantity),
  );
  for (const [id, qty] of totals) {
    const item = state.menu.find((m) => m.id === id);
    if (!item || item.stock < qty)
      throw new HttpError(409, "One or more items are out of stock");
  }
  for (const [id, qty] of totals)
    state.menu.find((m) => m.id === id)!.stock -= qty;
  const order = {
    id: randomUUID(),
    sessionId: session.id,
    externalId: event.externalId,
    items: event.items,
    organic: !event.discount,
    discount: event.discount,
    createdAt: new Date().toISOString(),
    voided: false,
  };
  state.orders.push(order);
  if (event.discount)
    state.instances
      .filter((i) => i.sessionId === session.id && i.status === "active")
      .forEach((i) => (i.status = "cancelled"));
  if (options.skipEvaluation) return { ok: true, orderId: order.id };
  const decision = evaluate(state, session.id, {
    requireIdentity: !demoMode,
    recommendation: options.recommendation,
  });
  invalidateActiveRewards(state, "POS ingestion", !demoMode);
  return { ok: true, orderId: order.id, decision };
}
export async function runCommand(raw: unknown, actor: string) {
  const command = commandSchema.parse(raw);
  return transact((state) => {
    const audit = (action: string, detail: string) =>
      state.audits.push({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        actor,
        action,
        detail,
      });
    const result = (() => {
      switch (command.action) {
        case "confirm_member":
          return confirmMemberCheckin(
            state,
            command.sessionId,
            command.code,
            secret("TABLEPULSE_CUSTOMER_SECRET"),
            actor,
          );
        case "order": {
          const result = ingestOrder(state, command.event);
          if (!result.duplicate)
            audit(
              "POS order received",
              `${command.event.externalId} · ${command.event.items.length} items`,
            );
          return result;
        }
        case "redeem":
          return redeem(
            state,
            command.sessionId,
            command.code,
            actor,
            Date.now(),
            !demoMode,
          );
        case "link_customer":
          linkCustomer(state, command.sessionId, command.customerRef);
          audit("POS customer linked", command.sessionId);
          return { ok: true };
        case "session": {
          if (!state.tables.find((t) => t.id === command.tableId))
            throw new HttpError(404, "Table not found");
          if (
            state.sessions.some(
              (s) => s.tableId === command.tableId && !s.closedAt,
            )
          )
            throw new HttpError(409, "Table already has an open session");
          const session = {
            id: randomUUID(),
            tableId: command.tableId,
            startedAt: new Date().toISOString(),
            ageVerified: false,
            intoxicated: false,
            blocked: false,
            offerReceived: false,
            control: randomInt(100) < state.settings.controlPercent,
          };
          state.sessions.push(session);
          audit("Table opened", command.tableId);
          return { ok: true, sessionId: session.id };
        }
        case "flags": {
          const session = requireSession(state, command.sessionId);
          Object.assign(session, {
            ageVerified: command.ageVerified,
            intoxicated: command.intoxicated,
            blocked: command.blocked,
          });
          if (session.blocked || session.intoxicated || !session.ageVerified)
            state.instances
              .filter(
                (i) =>
                  i.sessionId === session.id &&
                  i.status === "active" &&
                  (session.blocked ||
                    state.menu.find(
                      (m) =>
                        m.id ===
                        state.offers.find((o) => o.id === i.offerId)?.itemId,
                    )?.alcohol),
              )
              .forEach((i) => (i.status = "cancelled"));
          audit(
            "Table safety updated",
            `${session.id} · age verified ${session.ageVerified} · intoxication ${session.intoxicated} · blocked ${session.blocked}`,
          );
          return { ok: true };
        }
        case "close": {
          const session = requireSession(state, command.sessionId);
          session.closedAt = new Date().toISOString();
          state.instances
            .filter((i) => i.sessionId === session.id && i.status === "active")
            .forEach((i) => (i.status = "cancelled"));
          audit("Table bill closed", session.id);
          return { ok: true };
        }
        case "cancel": {
          const instance = state.instances.find(
            (i) => i.id === command.instanceId,
          );
          if (!instance || instance.status !== "active")
            throw new HttpError(409, "Offer is no longer active");
          instance.status = "cancelled";
          audit("Offer cancelled", `${instance.id}: ${command.reason}`);
          return { ok: true };
        }
        case "void": {
          const order = state.orders.find(
            (o) => o.id === command.orderId && !o.voided,
          );
          if (!order) throw new HttpError(404, "Order not found");
          requireSession(state, order.sessionId);
          if (
            !order.organic ||
            state.instances.some(
              (i) =>
                i.qualifyingOrderIds.includes(order.id) &&
                i.status === "redeemed",
            )
          )
            throw new HttpError(
              409,
              "Redeemed reward bills require a POS correction workflow",
            );
          order.voided = true;
          order.items.forEach(
            (i) =>
              (state.menu.find((m) => m.id === i.menuItemId)!.stock +=
                i.quantity),
          );
          state.instances
            .filter(
              (i) =>
                i.qualifyingOrderIds.includes(order.id) &&
                i.status === "active",
            )
            .forEach((i) => (i.status = "cancelled"));
          audit("Qualifying order voided", order.id);
          return { ok: true };
        }
        case "override": {
          requireSession(state, command.sessionId);
          const decision = evaluate(state, command.sessionId, {
            preferredOfferId: command.offerId,
            requireIdentity: !demoMode,
          });
          audit(
            "Staff offer override",
            `${command.reason} · ${decision.outcome} · ${decision.reasons.join("; ")}`,
          );
          return { ok: true, decision };
        }
        case "settings":
          state.settings = command.settings;
          audit(
            "Margin controls updated",
            `Minimum profit ${command.settings.minProfit}, minimum margin ${command.settings.minMarginPercent}%, minimum score ${command.settings.minScore}`,
          );
          return { ok: true };
        case "offer": {
          const offer = state.offers.find((o) => o.id === command.offerId);
          if (!offer) throw new HttpError(404, "Campaign not found");
          const item = state.menu.find((m) => m.id === offer.itemId)!;
          if (command.price > item.price)
            throw new HttpError(
              400,
              "Reward price cannot exceed the menu price",
            );
          Object.assign(offer, {
            price: command.price,
            dailyCap: command.dailyCap,
            priority: command.priority,
            enabled: command.enabled,
          });
          state.instances
            .filter((i) => i.offerId === offer.id && i.status === "active")
            .forEach((i) => (i.status = "cancelled"));
          audit(
            "Campaign updated",
            `${offer.name} · pending rewards cancelled to preserve exact terms`,
          );
          return { ok: true };
        }
        case "stock": {
          const item = state.menu.find((m) => m.id === command.menuItemId);
          if (!item) throw new HttpError(404, "Menu item not found");
          Object.assign(item, {
            stock: command.stock,
            cost: command.cost,
            promotionEligible: command.promotionEligible,
          });
          audit("Inventory updated", item.name);
          return { ok: true };
        }
        case "optout": {
          const customer = state.customers.find(
            (c) => c.id === command.customerId,
          );
          if (!customer) throw new HttpError(404, "Customer not found");
          customer.optedIn = false;
          customer.preferences = [];
          customer.entitlement = false;
          audit("Customer opted out", customer.id);
          return { ok: true };
        }
      }
    })();
    invalidateActiveRewards(state, actor, !demoMode);
    return result;
  });
}
