"use client";
import { useState, useEffect } from "react";
import {
  Ticket,
  ShieldCheck,
  Pencil,
  UtensilsCrossed,
  Check,
  Activity,
  SlidersHorizontal,
  AlertTriangle,
  Download,
  Users,
  TrendingUp,
  Info,
} from "lucide-react";
import { PageHeading, usePulse, Modal, Empty } from "./workspace";
import {
  money,
  margin,
  profit,
  type Offer,
  type MenuItem,
  type Settings,
} from "@/lib/types";
import { offerLabels, ServiceChart } from "./dashboard";
import { bill, basket, currentOrders } from "@/lib/basket";
function Access({ children }: { children: React.ReactNode }) {
  const { data } = usePulse();
  return data.role === "staff" ? (
    <Empty>
      Your staff role can manage tables and orders. Ask a manager to update
      venue controls.
    </Empty>
  ) : (
    children
  );
}
const descriptions: Record<string, string> = {
  drink_pairing: "Two mains, no drinks. An optional zero-alcohol pairing.",
  snack_addon: "Two beers on the bill. Something from the kitchen.",
  bottle_tradeup: "A main and a glass of wine. A selected bottle pairing.",
  return_entitlement: "An unused entitlement and a fresh qualifying purchase.",
  premium_upgrade: "Two mains and no sides. A profitable little upgrade.",
};
export function OffersView() {
  const { data, now, mutate, busy, notify } = usePulse();
  const [editing, setEditing] = useState<Offer>(),
    [filter, setFilter] = useState("all");
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
  }).format(now);
  return (
    <Access>
      <PageHeading
        eyebrow="CAMPAIGN MANAGEMENT"
        title="The right reward. The right margin."
        description="Occasional, relevant add-ons that earn more than they cost."
      >
        <span className="tag">
          <ShieldCheck size={13} /> Minimum profit{" "}
          {money(data.settings.minProfit)} · {data.settings.minMarginPercent}%
          margin
        </span>
      </PageHeading>
      <div className="section-toolbar">
        <div className="segmented">
          {["all", "enabled", "paused"].map((f) => (
            <button
              key={f}
              className={filter === f ? "active" : ""}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "All campaigns"
                : f === "enabled"
                  ? "Enabled"
                  : "Paused"}
            </button>
          ))}
        </div>
        <span className="muted">
          {data.offers.length} campaigns · One reward per visit
        </span>
      </div>
      <div className="campaign-grid">
        {data.offers
          .filter(
            (o) =>
              filter === "all" ||
              (filter === "enabled" ? o.enabled : !o.enabled),
          )
          .map((o) => {
            const item = data.menu.find((m) => m.id === o.itemId)!,
              issued = data.instances.filter(
                (i) =>
                  i.offerId === o.id &&
                  new Intl.DateTimeFormat("en-CA", {
                    timeZone: "Asia/Singapore",
                  }).format(new Date(i.createdAt)) === day,
              ).length,
              gp = (o.price - item.cost) * o.quantity,
              offerMargin = o.price
                ? ((o.price - item.cost) / o.price) * 100
                : 0,
              belowFloor =
                gp <= data.settings.minProfit ||
                offerMargin < data.settings.minMarginPercent;
            return (
              <article className="card campaign-card" key={o.id}>
                <div className="campaign-top">
                  <span className="campaign-icon">
                    <Ticket size={23} />
                  </span>
                  <span
                    className={`tag ${!o.enabled ? "neutral" : belowFloor ? "danger" : ""}`}
                  >
                    {!o.enabled
                      ? "Paused"
                      : belowFloor
                        ? "Below commercial floor"
                        : "Ready to evaluate"}
                  </span>
                </div>
                <h2>{o.name}</h2>
                <p>{descriptions[o.kind]}</p>
                <div className="campaign-price">
                  {money(o.price)}
                  <small>{money(item.price)}</small>
                </div>
                <span style={{ fontSize: 12, color: "#9aa58d", marginTop: 5 }}>
                  {o.quantity} × {item.name} · price per item
                </span>
                <div className="campaign-stats">
                  <span>Projected gross profit</span>
                  <strong>{money(gp)}</strong>
                </div>
                <div className="campaign-stats">
                  <span>Offer gross margin</span>
                  <strong>{offerMargin.toFixed(1)}%</strong>
                </div>
                <div className="campaign-stats">
                  <span>Today’s allocation</span>
                  <strong>
                    {issued} / {o.dailyCap}
                  </strong>
                </div>
                <div className="allocation-bar">
                  <span
                    style={{
                      width: `${Math.min(100, o.dailyCap ? (issued / o.dailyCap) * 100 : 100)}%`,
                    }}
                  />
                </div>
                <div className="campaign-footer">
                  <span>
                    {o.duration} min · {offerLabels[o.kind]}
                  </span>
                  <button
                    className="inline-button"
                    onClick={() => setEditing(o)}
                    aria-label={`Edit ${o.name}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className={`toggle ${o.enabled ? "on" : ""}`}
                    role="switch"
                    aria-checked={o.enabled}
                    aria-label={`Enable ${o.name}`}
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await mutate({
                          action: "offer",
                          offerId: o.id,
                          price: o.price,
                          dailyCap: o.dailyCap,
                          priority: o.priority,
                          enabled: !o.enabled,
                        });
                        notify(
                          o.enabled
                            ? "Campaign paused; pending rewards cancelled."
                            : "Campaign enabled.",
                        );
                      } catch {}
                    }}
                  />
                </div>
              </article>
            );
          })}
      </div>
      <div className="notice">
        <ShieldCheck size={19} />
        <span>
          Rewards never stack with other deals. Customers receive at most one
          subsidised reward per 30 days, and the same promotion cannot repeat
          within 60 days.
        </span>
      </div>
      {editing && (
        <OfferEditor offer={editing} onClose={() => setEditing(undefined)} />
      )}
    </Access>
  );
}
function OfferEditor({
  offer,
  onClose,
}: {
  offer: Offer;
  onClose: () => void;
}) {
  const { data, mutate, busy, notify } = usePulse(),
    [price, setPrice] = useState(offer.price),
    [cap, setCap] = useState(offer.dailyCap),
    [priority, setPriority] = useState(offer.priority);
  const item = data.menu.find((m) => m.id === offer.itemId)!;
  return (
    <Modal title={`Edit ${offer.name}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await mutate({
              action: "offer",
              offerId: offer.id,
              price,
              dailyCap: cap,
              priority,
              enabled: offer.enabled,
            });
            notify("Campaign saved. Existing pending rewards were cancelled.");
            onClose();
          } catch {}
        }}
      >
        <div className="form-row">
          <label className="form-field">
            Offer price per item (S$)
            <input
              type="number"
              step="0.1"
              min="0"
              max={item.price}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              required
            />
          </label>
          <label className="form-field">
            Daily allocation cap
            <input
              type="number"
              step="1"
              min="0"
              max="500"
              value={cap}
              onChange={(e) => setCap(Number(e.target.value))}
              required
            />
          </label>
        </div>
        <label className="form-field">
          <span className="range-label">
            Campaign priority<strong>{priority}</strong>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </label>
        <div className="detail-box">
          <span>Projected incremental gross profit</span>
          <strong>{money((price - item.cost) * offer.quantity)}</strong>
          <small className="muted">
            Venue floors: strictly greater than {money(data.settings.minProfit)}
            {" and at least "}
            {data.settings.minMarginPercent}% margin
          </small>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Saving cancels unredeemed instances of this campaign so customers
          never see changed terms. Allocation slots remain consumed.
        </p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            Save campaign
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function MenuView() {
  const { data } = usePulse();
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [editing, setEditing] = useState<MenuItem>();
  const filtered = data.menu.filter(
    (m) =>
      (category === "all" || m.category === category) &&
      m.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Access>
      <PageHeading
        eyebrow="MENU & INVENTORY"
        title="Know what every item earns."
        description="Live stock, item costs, and margins that keep your rewards profitable."
      />
      <div className="section-toolbar">
        <div className="segmented">
          {[
            "all",
            "food",
            "beer",
            "wine",
            "cocktail",
            "zero_alcohol",
            "snack",
          ].map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={category === c ? "active" : ""}
            >
              {c === "all"
                ? "All items"
                : c === "zero_alcohol"
                  ? "Zero alcohol"
                  : c[0].toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
        <input
          className="search-input"
          placeholder="Search menu items…"
          aria-label="Search menu items"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <section className="card data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Menu item</th>
              <th>Price</th>
              <th>Item cost</th>
              <th>Gross profit</th>
              <th>Margin</th>
              <th>Inventory</th>
              <th>Promotion</th>
              <th>Manage</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.name}
                  <small>
                    {m.category.replace("_", " ")}{" "}
                    {m.alcohol ? "· 18+ verified" : ""}
                  </small>
                </td>
                <td>{money(m.price)}</td>
                <td>{money(m.cost)}</td>
                <td style={{ color: "#6a8c51" }}>{money(profit(m))}</td>
                <td>{margin(m).toFixed(1)}%</td>
                <td>
                  <span
                    className={`tag ${m.stock === 0 ? "danger" : m.stock < 10 ? "warning" : ""}`}
                  >
                    {m.stock === 0 ? "Out of stock" : `${m.stock} in stock`}
                  </span>
                </td>
                <td>
                  <span
                    className={`tag ${m.promotionEligible ? "" : "neutral"}`}
                  >
                    {m.promotionEligible ? "Eligible" : "Excluded"}
                  </span>
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${m.name}`}
                    onClick={() => setEditing(m)}
                  >
                    <Pencil size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <Empty>No items match your search.</Empty>}
      </section>
      {editing && (
        <MenuEditor item={editing} onClose={() => setEditing(undefined)} />
      )}
    </Access>
  );
}
function MenuEditor({
  item,
  onClose,
}: {
  item: MenuItem;
  onClose: () => void;
}) {
  const { mutate, busy, notify } = usePulse(),
    [stock, setStock] = useState(item.stock),
    [cost, setCost] = useState(item.cost),
    [eligible, setEligible] = useState(item.promotionEligible);
  return (
    <Modal title={item.name} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await mutate({
              action: "stock",
              menuItemId: item.id,
              stock,
              cost,
              promotionEligible: eligible,
            });
            notify("Inventory and cost saved.");
            onClose();
          } catch {}
        }}
      >
        <div className="form-row">
          <label className="form-field">
            Available units
            <input
              type="number"
              min="0"
              max="10000"
              value={stock}
              onChange={(e) => setStock(Number(e.target.value))}
              required
            />
          </label>
          <label className="form-field">
            Item cost (S$)
            <input
              type="number"
              step="0.01"
              min="0"
              max="1000"
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
              required
            />
          </label>
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={eligible}
            onChange={(e) => setEligible(e.target.checked)}
          />
          Eligible for venue promotions
        </label>
        <div className="detail-box">
          <span>Gross margin at menu price</span>
          <strong>{margin({ ...item, cost }).toFixed(1)}%</strong>
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            Save item
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function SettingsView() {
  const { data, mutate, busy, notify } = usePulse();
  const [settings, setSettings] = useState<Settings>(data.settings);
  const change = (key: keyof Settings, value: number | boolean) =>
    setSettings({ ...settings, [key]: value });
  return (
    <Access>
      <PageHeading
        eyebrow="VENUE CONTROLS"
        title="Profit is the prerequisite."
        description="Set your commercial floors. The safety guardrails always stay on."
      />
      <div className="settings-grid">
        <section className="card settings-card">
          <h2>Margin & allocation controls</h2>
          <p>
            {data.venue.name} · {data.venue.location}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await mutate({ action: "settings", settings });
                notify("Venue guardrails saved.");
              } catch {}
            }}
          >
            <label className="form-field">
              Minimum incremental gross profit (S$)
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={settings.minProfit}
                required
                onChange={(e) => change("minProfit", Number(e.target.value))}
              />
              <p>
                A reward must earn strictly more than this after its item cost.
              </p>
            </label>
            <label className="form-field">
              Minimum incremental gross margin (%)
              <input
                type="number"
                step="1"
                min="0"
                max="95"
                value={settings.minMarginPercent}
                required
                onChange={(e) =>
                  change("minMarginPercent", Number(e.target.value))
                }
              />
              <p>
                Every offered item must keep at least this percentage of its
                offer revenue after item cost. Default: 30%.
              </p>
            </label>
            <label className="form-field">
              <span className="range-label">
                Minimum weighted score<strong>{settings.minScore}</strong>
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={settings.minScore}
                onChange={(e) => change("minScore", Number(e.target.value))}
              />
              <p>
                Relevance, profit, stock, frequency, priority and randomness.
              </p>
            </label>
            <label className="form-field">
              <span className="range-label">
                Random allocation probability
                <strong>
                  {Math.round(settings.allocationProbability * 100)}%
                </strong>
              </span>
              <input
                type="range"
                min="5"
                max="95"
                value={settings.allocationProbability * 100}
                onChange={(e) =>
                  change("allocationProbability", Number(e.target.value) / 100)
                }
              />
              <p>Eligible visits still have a chance of receiving no reward.</p>
            </label>
            <label className="form-field">
              <span className="range-label">
                Matched control allocation
                <strong>{settings.controlPercent}%</strong>
              </span>
              <input
                type="range"
                min="5"
                max="50"
                value={settings.controlPercent}
                onChange={(e) =>
                  change("controlPercent", Number(e.target.value))
                }
              />
              <p>
                Applied at the start of new visits, never changed mid-service.
              </p>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={settings.paused}
                onChange={(e) => change("paused", e.target.checked)}
              />
              Pause all venue reward campaigns
            </label>
            <button className="button primary" disabled={busy}>
              Save venue controls
            </button>
          </form>
        </section>
        <div>
          <section className="card settings-card">
            <ShieldCheck size={28} color="#7d9b60" />
            <h2 style={{ marginTop: 15 }}>Non-negotiable guardrails</h2>
            <ul className="guardrails-list">
              {[
                "Organic qualifying order comes first",
                "One reward per table visit, including cancellations",
                "One subsidised reward per customer every 30 days",
                "No repeat promotion within 60 days",
                "Current table and current bill only",
                "Qualifying items must remain on the bill",
                "No stacking with other discounts",
                "Real daily caps and live inventory checks",
                "Alcohol: verified 18+ and no intoxication flag",
                "Every decision and staff action is logged",
              ].map((t) => (
                <li key={t}>
                  <Check size={14} />
                  {t}
                </li>
              ))}
            </ul>
          </section>
          <div className="notice">
            <Info size={18} />
            <span>
              No payment processing is included. Your POS remains the source of
              truth for bill settlement.
            </span>
          </div>
        </div>
      </div>
      {data.role === "platform_admin" && (
        <section className="card settings-card" style={{ marginTop: 22 }}>
          <h2>Platform administration</h2>
          <p>
            This V1 deployment is scoped to one venue through
            TABLEPULSE_VENUE_ID. Team roles are provisioned in Supabase by a
            platform administrator.
          </p>
          <div className="tag">
            {data.mode === "demo" ? "Demo venue" : "Active venue"} ·{" "}
            {data.venue.name}
          </div>
        </section>
      )}
    </Access>
  );
}
export function ActivityView() {
  const { data } = usePulse();
  const [tab, setTab] = useState("decisions");
  return (
    <>
      <PageHeading
        eyebrow="TRANSPARENCY"
        title="Every decision has a reason."
        description="Eligibility decisions, staff actions, and rejected redemption attempts."
      />
      <div className="section-toolbar">
        <div className="segmented">
          <button
            className={tab === "decisions" ? "active" : ""}
            onClick={() => setTab("decisions")}
          >
            Offer decisions · {data.decisions.length}
          </button>
          <button
            className={tab === "audit" ? "active" : ""}
            onClick={() => setTab("audit")}
          >
            Audit log · {data.audits.length}
          </button>
        </div>
      </div>
      <section className="card">
        {tab === "decisions"
          ? data.decisions
              .slice()
              .reverse()
              .map((d) => {
                const s = data.sessions.find((s) => s.id === d.sessionId),
                  table = data.tables.find((t) => t.id === s?.tableId);
                return (
                  <div className="activity-row" key={d.id}>
                    <span className="activity-row-icon">
                      {d.outcome === "shown" ? (
                        <Ticket size={18} />
                      ) : (
                        <ShieldCheck size={18} />
                      )}
                    </span>
                    <div>
                      <h3>
                        {table?.name}{" "}
                        <span
                          className={`tag ${d.outcome === "withheld" ? "warning" : d.outcome === "control" ? "neutral" : ""}`}
                          style={{ marginLeft: 8 }}
                        >
                          {d.outcome === "shown"
                            ? "Reward unlocked"
                            : d.outcome === "control"
                              ? "Control cohort"
                              : "Withheld"}
                        </span>
                        {d.score && (
                          <span
                            className="muted"
                            style={{ fontSize: 12, marginLeft: 8 }}
                          >
                            Score {d.score.toFixed(1)}
                          </span>
                        )}
                      </h3>
                      {d.reasons.map((r, i) => (
                        <p key={i}>{r}</p>
                      ))}
                    </div>
                    <time>
                      {new Intl.DateTimeFormat("en-SG", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Singapore",
                      }).format(new Date(d.createdAt))}
                    </time>
                  </div>
                );
              })
          : data.audits
              .slice()
              .reverse()
              .map((a) => (
                <div className="activity-row" key={a.id}>
                  <span className="activity-row-icon">
                    {a.action === "Redemption rejected" ? (
                      <AlertTriangle size={18} />
                    ) : (
                      <Activity size={18} />
                    )}
                  </span>
                  <div>
                    <h3>{a.action}</h3>
                    <p>{a.detail}</p>
                    <small className="muted">Actor: {a.actor}</small>
                  </div>
                  <time>
                    {new Intl.DateTimeFormat("en-SG", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Singapore",
                    }).format(new Date(a.createdAt))}
                  </time>
                </div>
              ))}
        {!(tab === "decisions"
          ? data.decisions.length
          : data.audits.length) && (
          <Empty>Activity will appear as your service progresses.</Empty>
        )}
      </section>
    </>
  );
}
export function AnalyticsView() {
  const { data, now } = usePulse();
  const [period, setPeriod] = useState("today");
  const cutoff = now - (period === "today" ? 1 : 7) * 86400000,
    redemptions = data.redemptions.filter(
      (r) => new Date(r.createdAt).getTime() >= cutoff,
    ),
    instances = data.instances.filter(
      (i) => new Date(i.createdAt).getTime() >= cutoff,
    ),
    revenue = redemptions.reduce((n, r) => n + r.revenue, 0),
    gp = redemptions.reduce((n, r) => n + r.profit, 0),
    discount = redemptions.reduce((n, r) => n + r.discount, 0);
  const shown = data.sessions.filter((s) =>
      instances.some((i) => i.sessionId === s.id),
    ),
    controls = data.sessions.filter((s) => s.control),
    organicBill = (id: string) =>
      currentOrders(data, id)
        .filter((o) => o.organic)
        .reduce(
          (n, o) =>
            n +
            o.items.reduce(
              (v, i) =>
                v +
                i.quantity *
                  data.menu.find((m) => m.id === i.menuItemId)!.price,
              0,
            ),
          0,
        );
  const pairs = shown
    .map((s) => ({
      shown: s,
      control: controls
        .slice()
        .sort(
          (a, b) =>
            Math.abs(organicBill(a.id) - organicBill(s.id)) -
            Math.abs(organicBill(b.id) - organicBill(s.id)),
        )[0],
    }))
    .filter(
      (p) =>
        p.control &&
        organicBill(p.shown.id) > 0 &&
        Math.abs(organicBill(p.control.id) - organicBill(p.shown.id)) /
          organicBill(p.shown.id) <=
          0.3,
    );
  function exportReport() {
    const rows = [
      ["type", "allocated", "redeemed", "revenue_sgd", "estimated_gp_sgd"],
      ...data.offers.map((o) => {
        const allocated = instances.filter((i) => i.offerId === o.id),
          redeemed = redemptions.filter((r) =>
            allocated.some((i) => i.id === r.instanceId),
          );
        return [
          offerLabels[o.kind],
          allocated.length,
          redeemed.length,
          redeemed.reduce((n, r) => n + r.revenue, 0).toFixed(2),
          redeemed.reduce((n, r) => n + r.profit, 0).toFixed(2),
        ];
      }),
    ];
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], {
        type: "text/csv",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "tablepulse-service-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Access>
      <PageHeading
        eyebrow="COMMERCIAL PERFORMANCE"
        title="Measure the extra, not the noise."
        description="Recorded reward purchases, estimated margins, and a first look at control tables."
      >
        <select
          aria-label="Analytics reporting period"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          <option value="today">Last 24 hours</option>
          <option value="week">Last 7 days</option>
        </select>
        <button className="button secondary" onClick={exportReport}>
          <Download size={15} /> Export report
        </button>
      </PageHeading>
      <div className="analytics-stats">
        {[
          {
            label: "Reward revenue",
            value: money(revenue),
            text: "Net of promotional price",
          },
          {
            label: "Est. incremental gross profit",
            value: money(gp),
            text: "Reward revenue minus item costs",
          },
          {
            label: "Total discount cost",
            value: money(discount),
            text: "Menu price minus reward price",
          },
        ].map((s) => (
          <div className="card analytics-stat" key={s.label}>
            <span>{s.label}</span>
            <strong>{s.value}</strong>
            <small>{s.text}</small>
          </div>
        ))}
      </div>
      <div className="analytics-grid">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Reward performance by type</h2>
              <p>Actual allocations and redeemed purchases</p>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Offer type</th>
                  <th>Shown</th>
                  <th>Redeemed</th>
                  <th>Conversion</th>
                  <th>Est. GP</th>
                </tr>
              </thead>
              <tbody>
                {data.offers.map((o) => {
                  const alloc = instances.filter((i) => i.offerId === o.id),
                    red = redemptions.filter((r) =>
                      alloc.some((i) => i.id === r.instanceId),
                    );
                  return (
                    <tr key={o.id}>
                      <td>{offerLabels[o.kind]}</td>
                      <td>{alloc.length}</td>
                      <td>{red.length}</td>
                      <td>
                        {alloc.length
                          ? `${Math.round((red.length / alloc.length) * 100)}%`
                          : "—"}
                      </td>
                      <td>{money(red.reduce((n, r) => n + r.profit, 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card settings-card">
          <ShieldCheck size={25} color="#8ea674" />
          <h2 style={{ marginTop: 15 }}>Guardrails at work</h2>
          <ul className="guardrails-list">
            <li>
              <Users size={16} />
              <span>
                {
                  new Set(
                    data.decisions
                      .filter((d) => d.reasons.some((r) => /30-day/.test(r)))
                      .map(
                        (d) =>
                          data.sessions.find((s) => s.id === d.sessionId)
                            ?.customerId,
                      ),
                  ).size
                }{" "}
                customers hit frequency caps
              </span>
            </li>
            <li>
              <ShieldCheck size={16} />
              {
                data.audits.filter((a) => a.action === "Redemption rejected")
                  .length
              }{" "}
              suspicious or rejected redemptions
            </li>
            <li>
              <UtensilsCrossed size={16} />
              {data.menu.filter((m) => m.stock < 10).length} menu items with low
              stock
            </li>
          </ul>
          <p style={{ fontSize: 12, marginBottom: 0 }}>
            Rejected attempts are signals for review, not proof of fraud.
          </p>
        </section>
      </div>
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Offer tables vs matched controls</h2>
            <p>
              Nearest organic basket value within 30%; controls may be reused in
              this demo
            </p>
          </div>
          <span className="tag neutral">
            {pairs.length} matched comparisons
          </span>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Offer table</th>
                <th>Organic basket</th>
                <th>Reward purchase</th>
                <th>Control table</th>
                <th>Control bill</th>
                <th>Visit status</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, i) => (
                <tr key={i}>
                  <td>
                    {data.tables.find((t) => t.id === p.shown.tableId)?.name}
                  </td>
                  <td>{money(organicBill(p.shown.id))}</td>
                  <td>
                    {money(
                      data.redemptions
                        .filter((r) => r.sessionId === p.shown.id)
                        .reduce((n, r) => n + r.revenue, 0),
                    )}
                  </td>
                  <td>
                    {data.tables.find((t) => t.id === p.control.tableId)?.name}
                  </td>
                  <td>{money(bill(data, p.control.id))}</td>
                  <td>
                    {p.shown.closedAt && p.control.closedAt
                      ? "Both completed"
                      : "In progress"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!pairs.length && (
            <Empty>
              More comparable organic baskets are needed before a matched
              comparison is available.
            </Empty>
          )}
        </div>
        <p className="comparison-note">
          These are observational comparisons. Estimated incremental profit
          assumes the reward purchase was additional; it is not measured causal
          lift. Compare completed visits with enough samples before drawing
          conclusions.
        </p>
      </section>
    </Access>
  );
}
