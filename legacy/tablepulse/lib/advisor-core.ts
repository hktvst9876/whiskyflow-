import type { Category, State } from "./types";
import { basket, type OfferCandidate } from "./engine";

export interface AdvisorContext {
  currentBasket: Partial<Record<Category, number>>;
  candidates: Pick<
    OfferCandidate,
    | "offerId"
    | "kind"
    | "category"
    | "quantity"
    | "offerPrice"
    | "regularPrice"
    | "incrementalProfit"
    | "incrementalMarginPercent"
    | "stock"
    | "priority"
    | "preferenceMatch"
    | "baseScore"
    | "maximumScore"
  >[];
  customerContext: null | {
    explicitPreferences: Category[];
    associatedVisitCount: number;
    associatedPurchaseCategories: Partial<Record<Category, number>>;
  };
  objective: {
    minimumIncrementalProfit: number;
    minimumIncrementalMarginPercent: number;
    minimumScore: number;
  };
}
const counts = (pairs: { category: Category; quantity: number }[]) =>
  pairs.reduce<Partial<Record<Category, number>>>((total, row) => {
    total[row.category] = (total[row.category] ?? 0) + row.quantity;
    return total;
  }, {});

export function buildAdvisorContext(
  state: State,
  sessionId: string,
  candidates: OfferCandidate[],
): AdvisorContext {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Table session not found");
  const currentBasket = counts(
    basket(state, sessionId).map((line) => ({
      category: state.menu.find((item) => item.id === line.menuItemId)!
        .category,
      quantity: line.quantity,
    })),
  );
  const customer = state.customers.find(
    (value) => value.id === session.customerId && value.optedIn,
  );
  const historicalSessions = customer
    ? state.sessions
        .filter(
          (visit) =>
            visit.id !== sessionId &&
            visit.customerId === customer.id &&
            visit.customerVerified &&
            Date.now() - Date.parse(visit.startedAt) < 180 * 86400000,
        )
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 10)
    : [];
  const historicalSessionIds = new Set(
    historicalSessions.map((visit) => visit.id),
  );
  const historicalLines = state.orders
    .filter(
      (order) => historicalSessionIds.has(order.sessionId) && !order.voided,
    )
    .flatMap((order) => order.items)
    .map((line) => ({
      category: state.menu.find((item) => item.id === line.menuItemId)!
        .category,
      quantity: line.quantity,
    }));
  return {
    currentBasket,
    candidates: candidates.map(
      ({
        offerId,
        kind,
        category,
        quantity,
        offerPrice,
        regularPrice,
        incrementalProfit,
        incrementalMarginPercent,
        stock,
        priority,
        preferenceMatch,
        baseScore,
        maximumScore,
      }) => ({
        offerId,
        kind,
        category,
        quantity,
        offerPrice,
        regularPrice,
        incrementalProfit,
        incrementalMarginPercent,
        stock,
        priority,
        preferenceMatch,
        baseScore,
        maximumScore,
      }),
    ),
    customerContext: customer
      ? {
          explicitPreferences: customer.preferences,
          associatedVisitCount: historicalSessions.length,
          associatedPurchaseCategories: counts(historicalLines),
        }
      : null,
    objective: {
      minimumIncrementalProfit: state.settings.minProfit,
      minimumIncrementalMarginPercent: state.settings.minMarginPercent,
      minimumScore: state.settings.minScore,
    },
  };
}

export function responseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return undefined;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content)
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      )
        return (part as { text: string }).text;
  }
  return undefined;
}
