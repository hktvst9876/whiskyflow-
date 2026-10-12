import { randomUUID, randomInt } from "node:crypto";
import type { State, Session, Offer, Decision, OfferInstance } from "./types";
import { currentOrders, basket } from "./basket";
export { currentOrders, basket, bill } from "./basket";
export interface OfferCandidate {
  offerId: string;
  offerName: string;
  kind: Offer["kind"];
  itemName: string;
  category: State["menu"][number]["category"];
  quantity: number;
  offerPrice: number;
  regularPrice: number;
  incrementalProfit: number;
  incrementalMarginPercent: number;
  stock: number;
  priority: number;
  preferenceMatch: boolean;
  baseScore: number;
  maximumScore: number;
}
export interface OfferRecommendation {
  offerId: string | null;
  rationale: string;
}
export const singaporeDay = (date: string | number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
export const incrementalProfit = (
  price: number,
  cost: number,
  quantity: number,
) => ((Math.round(price * 100) - Math.round(cost * 100)) * quantity) / 100;
export const incrementalMarginPercent = (price: number, cost: number) =>
  price <= 0 ? 0 : ((price - cost) / price) * 100;
function matches(state: State, session: Session, offer: Offer) {
  const items = basket(state, session.id),
    qty = (filter: (m: State["menu"][number]) => boolean) =>
      items.reduce(
        (n, i) =>
          n +
          (filter(state.menu.find((m) => m.id === i.menuItemId)!)
            ? i.quantity
            : 0),
        0,
      );
  if (items.some((i) => i.menuItemId === offer.itemId)) return false;
  if (
    offer.requiredItemIds?.some((id) => !items.some((i) => i.menuItemId === id))
  )
    return false;
  const mains = qty((m) => !!m.main),
    drinks = qty((m) =>
      ["beer", "wine", "cocktail", "zero_alcohol"].includes(m.category),
    );
  switch (offer.kind) {
    case "drink_pairing":
      return mains >= 2 && drinks === 0;
    case "snack_addon":
      return (
        qty((m) => m.category === "beer") >= 2 &&
        qty((m) => m.category === "snack") === 0
      );
    case "bottle_tradeup":
      return (
        items.some((i) =>
          state.menu.find(
            (m) => m.id === i.menuItemId && /ribeye|pasta/i.test(m.name),
          ),
        ) &&
        qty((m) => m.category === "wine" && !m.bottle) === 1 &&
        qty((m) => !!m.bottle) === 0
      );
    case "return_entitlement":
      return (
        mains >= 1 &&
        !!state.customers.find(
          (c) => c.id === session.customerId && c.optedIn && c.entitlement,
        )
      );
    case "premium_upgrade":
      return mains >= 2 && qty((m) => m.category === "snack") === 0;
  }
}
export function safetyReasons(
  state: State,
  session: Session,
  now = Date.now(),
  redemption = false,
  requireIdentity = false,
): string[] {
  const reasons: string[] = [],
    orders = currentOrders(state, session.id);
  if (session.closedAt) reasons.push("Table session is closed");
  if (requireIdentity && (!session.customerId || !session.customerVerified))
    reasons.push(
      "A verified customer link is needed to enforce the customer reward cap",
    );
  if (session.blocked) reasons.push("Staff blocked this table");
  if (state.settings.paused) reasons.push("Venue campaigns are paused");
  if (!orders.some((o) => o.organic && !o.discount && o.items.length > 0))
    reasons.push("No qualifying organic order");
  if (orders.some((o) => o.discount))
    reasons.push("Another discount is already on the bill");
  if (!redemption && session.offerReceived)
    reasons.push("One-off table reward already allocated");
  if (!redemption && session.rewardAttemptedAt)
    reasons.push("This visit's reward opportunity has already been used");
  if (
    session.customerId &&
    state.instances.some(
      (i) =>
        i.sessionId !== session.id &&
        i.status === "active" &&
        Date.parse(i.expiresAt) > now &&
        state.sessions.find((s) => s.id === i.sessionId)?.customerId ===
          session.customerId,
    )
  )
    reasons.push("Customer already has an active reward at another table");
  if (
    session.customerId &&
    state.history.some(
      (h) =>
        h.customerId === session.customerId &&
        h.redeemedAt &&
        now - new Date(h.redeemedAt).getTime() < 30 * 86400000,
    )
  )
    reasons.push("Customer reached the 30-day reward cap");
  return reasons;
}
export function offerCandidates(
  state: State,
  sessionId: string,
  now = Date.now(),
  preferredOfferId?: string,
) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Table session not found");
  const candidates: OfferCandidate[] = [],
    rejected: string[] = [];
  let meaningfulOpportunity = false;
  for (const offer of state.offers.filter(
    (o) => o.enabled && (!preferredOfferId || o.id === preferredOfferId),
  )) {
    const item = state.menu.find((m) => m.id === offer.itemId)!;
    if (!matches(state, session, offer)) {
      rejected.push(`${offer.name}: basket has no incremental match`);
      continue;
    }
    if (!item.promotionEligible || item.stock < offer.quantity) {
      rejected.push(`${offer.name}: item unavailable for promotion`);
      continue;
    }
    if (item.alcohol && (!session.ageVerified || session.intoxicated)) {
      rejected.push(`${offer.name}: alcohol safety check failed`);
      continue;
    }
    if (
      state.instances.filter(
        (i) =>
          i.offerId === offer.id &&
          singaporeDay(i.createdAt) === singaporeDay(now),
      ).length >= offer.dailyCap
    ) {
      rejected.push(`${offer.name}: daily allocation used`);
      continue;
    }
    if (
      session.customerId &&
      state.history.some(
        (h) =>
          h.customerId === session.customerId &&
          h.offerId === offer.id &&
          now - new Date(h.createdAt).getTime() < 60 * 86400000,
      )
    ) {
      rejected.push(`${offer.name}: same promotion within 60 days`);
      continue;
    }
    const gp = incrementalProfit(offer.price, item.cost, offer.quantity),
      marginPercent = incrementalMarginPercent(offer.price, item.cost);
    if (gp <= state.settings.minProfit) {
      rejected.push(`${offer.name}: below incremental profit floor`);
      continue;
    }
    if (marginPercent < state.settings.minMarginPercent) {
      rejected.push(`${offer.name}: below incremental margin floor`);
      continue;
    }
    const preferenceMatch =
      state.customers
        .find((c) => c.id === session.customerId && c.optedIn)
        ?.preferences.includes(item.category) ?? false;
    meaningfulOpportunity = true;
    const baseScore =
      28 +
      (preferenceMatch ? 2 : 0) +
      Math.min(25, (gp / 20) * 25) +
      Math.min(15, item.stock / offer.quantity / 3) +
      10 +
      offer.priority / 10;
    candidates.push({
      offerId: offer.id,
      offerName: offer.name,
      kind: offer.kind,
      itemName: item.name,
      category: item.category,
      quantity: offer.quantity,
      offerPrice: offer.price,
      regularPrice: item.price,
      incrementalProfit: gp,
      incrementalMarginPercent: marginPercent,
      stock: item.stock,
      priority: offer.priority,
      preferenceMatch,
      baseScore,
      maximumScore: baseScore + 10,
    });
  }
  return { candidates, rejected, meaningfulOpportunity };
}
export function evaluate(
  state: State,
  sessionId: string,
  options: {
    now?: number;
    random?: () => number;
    preferredOfferId?: string;
    requireIdentity?: boolean;
    recommendation?: OfferRecommendation;
  } = {},
): Decision {
  const now = options.now ?? Date.now(),
    rng = options.random ?? (() => randomInt(1000000) / 1000000),
    session = state.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Table session not found");
  const log: Decision = {
    id: randomUUID(),
    sessionId,
    createdAt: new Date(now).toISOString(),
    outcome: "withheld",
    reasons: safetyReasons(state, session, now, false, options.requireIdentity),
  };
  const finish = () => {
    state.decisions.push(log);
    return log;
  };
  if (log.reasons.length) return finish();
  if (session.control) {
    session.rewardAttemptedAt = log.createdAt;
    log.outcome = "control";
    log.reasons = ["Assigned to the control cohort for this visit"];
    return finish();
  }
  const facts = offerCandidates(
    state,
    session.id,
    now,
    options.preferredOfferId,
  );
  const candidates: { offer: Offer; profit: number; score: number }[] = [],
    rejected = [...facts.rejected];
  for (const candidate of facts.candidates) {
    const offer = state.offers.find((o) => o.id === candidate.offerId)!;
    const score = candidate.baseScore + rng() * 10;
    if (score <= state.settings.minScore) {
      rejected.push(
        `${offer.name}: score below threshold (${score.toFixed(1)})`,
      );
      continue;
    }
    candidates.push({
      offer,
      profit: candidate.incrementalProfit,
      score,
    });
  }
  if (facts.meaningfulOpportunity) session.rewardAttemptedAt = log.createdAt;
  if (!candidates.length) {
    log.reasons = rejected.length ? rejected : ["No enabled campaign"];
    return finish();
  }
  if (options.recommendation?.offerId === null) {
    log.selectionSource = "ai";
    log.advisorRationale = options.recommendation.rationale;
    log.reasons = ["AI advisor selected no offer for this opportunity"];
    return finish();
  }
  let selected = options.recommendation
    ? candidates.find((c) => c.offer.id === options.recommendation!.offerId)
    : candidates.sort((a, b) => b.score - a.score)[0];
  if (options.recommendation && !selected) {
    log.selectionSource = "ai";
    log.advisorRationale = options.recommendation.rationale;
    log.reasons = [
      "AI-selected offer did not pass the final transactional checks",
      ...rejected,
    ];
    return finish();
  }
  if (rng() > state.settings.allocationProbability) {
    log.reasons = [
      "Random allocation withheld this reward to keep offers unpredictable",
    ];
    return finish();
  }
  selected = selected!;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const instance: OfferInstance = {
    id: randomUUID(),
    sessionId,
    offerId: selected.offer.id,
    code: Array.from(
      { length: 6 },
      () => alphabet[randomInt(alphabet.length)],
    ).join(""),
    createdAt: log.createdAt,
    expiresAt: new Date(now + selected.offer.duration * 60000).toISOString(),
    status: "active",
    qualifyingOrderIds: currentOrders(state, sessionId)
      .filter((o) => o.organic && !o.discount)
      .map((o) => o.id),
    projectedProfit: selected.profit,
    score: Math.round(selected.score * 10) / 10,
  };
  state.instances.push(instance);
  session.offerReceived = true;
  if (session.customerId)
    state.history.push({
      customerId: session.customerId,
      offerId: selected.offer.id,
      createdAt: log.createdAt,
    });
  log.outcome = "shown";
  log.offerId = selected.offer.id;
  log.score = instance.score;
  log.selectionSource = options.recommendation ? "ai" : "rules";
  if (options.recommendation)
    log.advisorRationale = options.recommendation.rationale;
  log.reasons = [
    "Organic order qualified",
    "Incremental purchase match",
    "Profit floor and allocation passed",
    ...rejected,
  ];
  return finish();
}
export function redeem(
  state: State,
  sessionId: string,
  code: string,
  actor: string,
  now = Date.now(),
  requireIdentity = false,
) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Table session not found");
  const instance = state.instances.find(
    (i) => i.sessionId === sessionId && i.code === code.trim().toUpperCase(),
  );
  let reasons = safetyReasons(state, session, now, true, requireIdentity);
  if (
    state.audits.filter(
      (a) =>
        a.action === "Redemption rejected" &&
        a.sessionId === sessionId &&
        now - new Date(a.createdAt).getTime() < 300000,
    ).length >= 5
  )
    reasons.push(
      "Too many failed attempts. Ask a manager and retry after five minutes",
    );
  if (!instance) reasons.push("Code does not belong to this table and bill");
  else {
    if (instance.status !== "active")
      reasons.push("Reward has already been used or cancelled");
    if (new Date(instance.expiresAt).getTime() <= now)
      reasons.push("Reward has expired");
    if (
      instance.qualifyingOrderIds.some(
        (id) => !state.orders.find((o) => o.id === id && !o.voided),
      )
    )
      reasons.push("Qualifying items no longer on the bill");
    const offer = state.offers.find((o) => o.id === instance.offerId)!;
    const item = state.menu.find((m) => m.id === offer.itemId)!;
    if (!offer.enabled || !item.promotionEligible)
      reasons.push("Promotion is no longer available");
    if (item.stock < offer.quantity) reasons.push("Item is out of stock");
    if (item.alcohol && (!session.ageVerified || session.intoxicated))
      reasons.push("Alcohol safety check failed");
    if (
      incrementalProfit(offer.price, item.cost, offer.quantity) <=
      state.settings.minProfit
    )
      reasons.push("Current incremental profit floor is not met");
    if (
      incrementalMarginPercent(offer.price, item.cost) <
      state.settings.minMarginPercent
    )
      reasons.push("Current incremental margin floor is not met");
  }
  const createdAt = new Date(now).toISOString();
  if (reasons.length) {
    state.audits.push({
      id: randomUUID(),
      createdAt,
      actor,
      sessionId,
      action: "Redemption rejected",
      detail: `${state.tables.find((t) => t.id === session.tableId)?.name}: ${reasons.join("; ")}`,
    });
    return { ok: false, reasons };
  }
  const offer = state.offers.find((o) => o.id === instance!.offerId)!;
  const item = state.menu.find((m) => m.id === offer.itemId)!;
  instance!.status = "redeemed";
  instance!.redeemedAt = createdAt;
  item.stock -= offer.quantity;
  state.orders.push({
    id: randomUUID(),
    externalId: `reward-${instance!.id}`,
    sessionId,
    items: [
      { menuItemId: item.id, quantity: offer.quantity, unitPrice: offer.price },
    ],
    organic: false,
    discount: true,
    createdAt,
    voided: false,
  });
  state.redemptions.push({
    id: randomUUID(),
    instanceId: instance!.id,
    sessionId,
    revenue: offer.price * offer.quantity,
    profit: incrementalProfit(offer.price, item.cost, offer.quantity),
    discount: incrementalProfit(item.price, offer.price, offer.quantity),
    createdAt,
  });
  const history = state.history.find(
    (h) =>
      h.customerId === session.customerId &&
      h.offerId === offer.id &&
      h.createdAt === instance!.createdAt,
  );
  if (history) history.redeemedAt = createdAt;
  else if (session.customerId)
    state.history.push({
      customerId: session.customerId,
      offerId: offer.id,
      createdAt: instance!.createdAt,
      redeemedAt: createdAt,
    });
  if (offer.kind === "return_entitlement") {
    const customer = state.customers.find((c) => c.id === session.customerId);
    if (customer) customer.entitlement = false;
  }
  state.audits.push({
    id: randomUUID(),
    createdAt,
    actor,
    action: "Reward redeemed",
    detail: `${state.tables.find((t) => t.id === session.tableId)?.name} · ${offer.name} · verified current bill`,
  });
  return { ok: true, reasons: [] };
}
export function invalidateActiveRewards(
  state: State,
  actor: string,
  requireIdentity = false,
) {
  for (const instance of state.instances.filter(
    (i) => i.status === "active" && Date.parse(i.expiresAt) > Date.now(),
  )) {
    const session = state.sessions.find((s) => s.id === instance.sessionId)!,
      offer = state.offers.find((o) => o.id === instance.offerId)!,
      item = state.menu.find((m) => m.id === offer.itemId)!;
    const reasons = safetyReasons(
      state,
      session,
      Date.now(),
      true,
      requireIdentity,
    );
    if (!offer.enabled || !item.promotionEligible)
      reasons.push("Campaign unavailable");
    if (item.stock < offer.quantity) reasons.push("Insufficient stock");
    if (item.alcohol && (!session.ageVerified || session.intoxicated))
      reasons.push("Alcohol safety check failed");
    if (
      incrementalProfit(offer.price, item.cost, offer.quantity) <=
      state.settings.minProfit
    )
      reasons.push("Profit floor no longer met");
    if (
      incrementalMarginPercent(offer.price, item.cost) <
      state.settings.minMarginPercent
    )
      reasons.push("Margin floor no longer met");
    if (
      instance.qualifyingOrderIds.some(
        (id) => !state.orders.find((o) => o.id === id && !o.voided),
      )
    )
      reasons.push("Qualifying order removed");
    if (basket(state, session.id).some((b) => b.menuItemId === offer.itemId))
      reasons.push("Reward item already purchased organically");
    if (reasons.length) {
      instance.status = "cancelled";
      state.audits.push({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        actor,
        action: "Offer cancelled by guardrails",
        sessionId: session.id,
        detail: `${state.tables.find((t) => t.id === session.tableId)?.name}: ${reasons.join("; ")}`,
      });
    }
  }
}
