import type { State, BasketItem } from "./types";
export const currentOrders = (state: State, sessionId: string) =>
  state.orders.filter((o) => o.sessionId === sessionId && !o.voided);
export const basket = (state: State, sessionId: string): BasketItem[] =>
  currentOrders(state, sessionId).flatMap((o) => o.items);
export const bill = (state: State, sessionId: string) =>
  basket(state, sessionId).reduce(
    (total, b) =>
      total +
      b.quantity *
        (b.unitPrice ??
          state.menu.find((m) => m.id === b.menuItemId)?.price ??
          0),
    0,
  );
