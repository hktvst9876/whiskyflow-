"use client";
import { useState } from "react";
import {
  Plus,
  Minus,
  FlaskConical,
  UtensilsCrossed,
  Beer,
  Wine,
  ShieldCheck,
  Send,
  RotateCcw,
} from "lucide-react";
import { usePulse, PageHeading, Empty, Modal } from "./workspace";
import { money, type BasketItem, type Decision } from "@/lib/types";
export function OrderComposer({
  sessionId,
  onSent,
}: {
  sessionId?: string;
  onSent?: (decision?: Decision) => void;
}) {
  const { data, mutate, busy, notify } = usePulse();
  const [selected, setSelected] = useState(
      sessionId ??
        data.sessions.find((s) => !s.closedAt && !s.offerReceived)?.id ??
        data.sessions.find((s) => !s.closedAt)?.id ??
        "",
    ),
    [quantities, setQuantities] = useState<Record<string, number>>({}),
    [discount, setDiscount] = useState(false),
    [query, setQuery] = useState("");
  const sessions = data.sessions.filter((s) => !s.closedAt),
    items: BasketItem[] = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
    total = items.reduce(
      (n, i) =>
        n + data.menu.find((m) => m.id === i.menuItemId)!.price * i.quantity,
      0,
    );
  async function submit() {
    try {
      const result = await mutate({
        action: "order",
        event: {
          externalId: `mock-${crypto.randomUUID()}`,
          sessionId: selected,
          items,
          discount,
        },
      });
      setQuantities({});
      notify(
        result.decision?.outcome === "shown"
          ? "Order sent. A table reward just unlocked."
          : "Order sent. Eligibility decision recorded.",
      );
      onSent?.(result.decision);
    } catch {}
  }
  return (
    <div className="composer">
      <h2>Build an organic order</h2>
      <div className="form-row">
        <label className="form-field">
          Table session
          <select
            aria-label="Table session"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={!!sessionId}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {data.tables.find((t) => t.id === s.tableId)?.name} ·{" "}
                {s.offerReceived
                  ? "reward already allocated"
                  : s.control
                    ? "control cohort"
                    : "no reward yet"}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          Find a menu item
          <input
            placeholder="Search the menu…"
            aria-label="Find a menu item"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="menu-picker">
        {data.menu
          .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
          .map((m) => (
            <div className="menu-picker-row" key={m.id}>
              <div>
                <strong>{m.name}</strong>
                <small>
                  {money(m.price)} · {m.stock} in stock{" "}
                  {m.alcohol ? "· Alcohol" : ""}
                </small>
              </div>
              <div className="stepper">
                <button
                  aria-label={`Remove ${m.name}`}
                  disabled={!quantities[m.id]}
                  onClick={() =>
                    setQuantities({
                      ...quantities,
                      [m.id]: Math.max(0, (quantities[m.id] ?? 0) - 1),
                    })
                  }
                >
                  <Minus size={12} />
                </button>
                <span>{quantities[m.id] ?? 0}</span>
                <button
                  aria-label={`Add ${m.name}`}
                  disabled={(quantities[m.id] ?? 0) >= Math.min(50, m.stock)}
                  onClick={() =>
                    setQuantities({
                      ...quantities,
                      [m.id]: (quantities[m.id] ?? 0) + 1,
                    })
                  }
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
          ))}
      </div>
      <label className="check-field" style={{ marginTop: 15 }}>
        <input
          type="checkbox"
          checked={discount}
          onChange={(e) => setDiscount(e.target.checked)}
        />
        This bill has another discount or happy hour deal
      </label>
      <div className="composer-total">
        <span>New order total</span>
        <strong>{money(total)}</strong>
      </div>
      <button
        className="button primary"
        disabled={busy || !items.length || !selected}
        onClick={submit}
      >
        <Send size={16} />
        Send order & evaluate
      </button>
    </div>
  );
}
export function SimulatorView() {
  const { data, mutate, busy, notify } = usePulse();
  const [decision, setDecision] = useState<Decision>(),
    [reset, setReset] = useState(false),
    [scenario, setScenario] = useState("");
  const noReward = data.sessions.filter(
    (s) => !s.closedAt && !s.offerReceived && !s.control && !s.blocked,
  );
  async function run(kind: string) {
    try {
      const table = data.tables.find(
        (t) => !data.sessions.some((s) => s.tableId === t.id && !s.closedAt),
      );
      let sessionId: string;
      if (table) {
        const result = await mutate({ action: "session", tableId: table.id });
        sessionId = result.sessionId;
      } else if (noReward.length) {
        sessionId = noReward[0].id;
      } else {
        notify(
          "All tables have a reward or are in control. Open a fresh visit or reset the demo.",
        );
        return;
      }
      const menuIds =
        kind === "beer"
          ? [8]
          : kind === "wine"
            ? [0, 11]
            : kind === "discount"
              ? [0]
              : [0, 1];
      const items = menuIds.map((i) => ({
        menuItemId: data.menu[i].id,
        quantity: kind === "beer" || kind === "discount" ? 2 : 1,
      }));
      const result = await mutate({
        action: "order",
        event: {
          externalId: `scenario-${crypto.randomUUID()}`,
          sessionId,
          items,
          discount: kind === "discount",
        },
      });
      setDecision(result.decision);
      setScenario(kind);
      notify("Scenario sent. The decision is shown below.");
    } catch {}
  }
  return (
    <>
      <PageHeading
        eyebrow="DEMO TOOLS"
        title="Make the next moment happen."
        description="Send mock POS events through the same engine your venue will use."
      >
        {data.mode === "demo" && data.role !== "staff" && (
          <button className="button secondary" onClick={() => setReset(true)}>
            <RotateCcw size={15} /> Reset demo
          </button>
        )}
      </PageHeading>
      <div className="simulator-grid">
        <section className="card">
          <OrderComposer onSent={setDecision} />
        </section>
        <div>
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>Try a service scenario</h2>
                <p>Fresh visits where possible. Safety rules always apply.</p>
              </div>
              <FlaskConical size={20} className="muted" />
            </div>
            <div className="scenario-list">
              {[
                {
                  key: "mains",
                  icon: UtensilsCrossed,
                  title: "Two mains, no drinks",
                  text: "Look for a profitable zero-alcohol pairing.",
                },
                {
                  key: "beer",
                  icon: Beer,
                  title: "Two beers, a little appetite",
                  text: "Consider a snack, never more alcohol.",
                },
                {
                  key: "wine",
                  icon: Wine,
                  title: "A main and a glass of wine",
                  text: "Bottle trade-up requires staff age verification.",
                },
                {
                  key: "discount",
                  icon: ShieldCheck,
                  title: "A discounted bill",
                  text: "Watch the no-stacking guardrail withhold a reward.",
                },
              ].map((s) => (
                <button
                  key={s.key}
                  className="scenario-button"
                  disabled={busy}
                  onClick={() => run(s.key)}
                >
                  <s.icon size={20} />
                  <div>
                    <strong>{s.title}</strong>
                    <span>{s.text}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
          {decision ? (
            <section className="decision-result" aria-live="polite">
              <div className="section-toolbar">
                <h3>
                  {decision.outcome === "shown"
                    ? "Reward unlocked"
                    : decision.outcome === "control"
                      ? "Control cohort"
                      : "Reward withheld"}
                </h3>
                <span
                  className={`tag ${decision.outcome === "shown" ? "" : "warning"}`}
                >
                  {decision.score
                    ? `Score ${decision.score}`
                    : "Guardrail decision"}
                </span>
              </div>
              <ul>
                {decision.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <p style={{ fontSize: 12, color: "#889b76" }}>
                Random allocation can withhold an otherwise eligible offer.
              </p>
            </section>
          ) : (
            <div className="notice">
              <ShieldCheck size={18} />
              <span>
                The simulator does not force rewards. Margin floors, customer
                caps, control groups, and random allocation stay active.
              </span>
            </div>
          )}
        </div>
      </div>
      {reset && (
        <Modal
          title="Start a fresh demo service?"
          onClose={() => setReset(false)}
        >
          <p style={{ color: "#849477", marginBottom: 20 }}>
            This replaces local sample orders and restores the original menu,
            tables, and campaigns. Live Supabase data cannot be reset here.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setReset(false)}
            >
              Keep this service
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                try {
                  await mutate({}, "/api/demo/reset");
                  setDecision(undefined);
                  setReset(false);
                  notify("Demo service restored.");
                } catch {}
              }}
            >
              Reset sample data
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
