"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  ChevronDown,
  ArrowUpRight,
  Armchair,
  Ticket,
  Coins,
  TrendingUp,
  Clock,
  ShieldCheck,
  Check,
  Info,
  Monitor,
  CalendarDays,
  UtensilsCrossed,
  Beer,
  GlassWater,
} from "lucide-react";
import { usePulse, PageHeading, Empty } from "./workspace";
import { money } from "@/lib/types";
import { bill } from "@/lib/basket";
import type { State } from "@/lib/types";
export const offerLabels: Record<string, string> = {
  drink_pairing: "Drink pairing",
  snack_addon: "Snack add-on",
  bottle_tradeup: "Bottle trade-up",
  return_entitlement: "Return reward",
  premium_upgrade: "Premium side",
};
export function Countdown({ expiresAt }: { expiresAt: string }) {
  const { now } = usePulse();
  const sec = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - now) / 1000),
  );
  return (
    <span className="countdown">
      <Clock size={12} />
      {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
    </span>
  );
}
export function ServiceChart({
  state,
  period = "today",
}: {
  state: State;
  period?: string;
}) {
  const { now } = usePulse();
  const width = 650,
    height = 185,
    groups = 7,
    windowMs = period === "week" ? 7 * 86400000 : 6 * 3600000,
    step = windowMs / (groups - 1);
  const values = Array.from({ length: groups }, (_, i) => {
    const from = now - windowMs + i * step,
      to = from + step;
    const rows = state.redemptions.filter(
      (r) =>
        new Date(r.createdAt).getTime() >= from &&
        new Date(r.createdAt).getTime() < to,
    );
    return {
      revenue: rows.reduce((n, r) => n + r.revenue, 0),
      profit: rows.reduce((n, r) => n + r.profit, 0),
    };
  });
  const maximum = Math.max(20, ...values.map((v) => v.revenue)),
    point = (value: number, index: number) =>
      `${((index * width) / (groups - 1)).toFixed(1)},${(height - (value / maximum) * (height - 12)).toFixed(1)}`;
  const rev = values.map((v, i) => point(v.revenue, i)).join(" "),
    gp = values.map((v, i) => point(v.profit, i)).join(" ");
  return (
    <div className="chart-wrap">
      <div className="chart-y">
        <span>{money(maximum)}</span>
        <span>{money(maximum / 2)}</span>
        <span>S$0</span>
      </div>
      <div className="chart-main">
        <svg
          viewBox={`0 0 ${width} ${height + 4}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Recorded reward revenue and estimated gross profit over time"
        >
          <defs>
            <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2b6650" stopOpacity=".13" />
              <stop offset="1" stopColor="#2b6650" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[12, height / 2, height].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2={width}
              y2={y}
              stroke="#e7ebe7"
              strokeDasharray="4 5"
            />
          ))}
          <polygon
            points={`0,${height} ${gp} ${width},${height}`}
            fill="url(#profitFill)"
          />
          <polyline
            points={rev}
            fill="none"
            stroke="#dd9f72"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <polyline
            points={gp}
            fill="none"
            stroke="#357257"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {values.map(
            (v, i) =>
              v.profit > 0 && (
                <circle
                  key={i}
                  cx={(i * width) / (groups - 1)}
                  cy={height - (v.profit / maximum) * (height - 12)}
                  r="4"
                  fill="#fff"
                  stroke="#357257"
                  strokeWidth="2"
                />
              ),
          )}
        </svg>
        <div className="chart-x">
          {values.map((_, i) => (
            <span key={i}>
              {new Intl.DateTimeFormat("en-SG", {
                timeZone: "Asia/Singapore",
                ...(period === "week"
                  ? { weekday: "short" }
                  : { hour: "numeric", hour12: true }),
              }).format(new Date(now - windowMs + i * step))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
export function TableTile({
  table,
  compact = false,
}: {
  table: State["tables"][number];
  compact?: boolean;
}) {
  const { data, now } = usePulse();
  const session = data.sessions.find(
      (s) => s.tableId === table.id && !s.closedAt,
    ),
    instance = session
      ? data.instances.find(
          (i) =>
            i.sessionId === session.id &&
            i.status === "active" &&
            new Date(i.expiresAt).getTime() > now,
        )
      : undefined,
    redeemed =
      session &&
      data.instances.some(
        (i) => i.sessionId === session.id && i.status === "redeemed",
      );
  const status = instance
    ? "reward"
    : session?.blocked
      ? "blocked"
      : redeemed
        ? "redeemed"
        : session
          ? "occupied"
          : "available";
  return (
    <Link
      href={`/tables?table=${table.id}`}
      className={`table-tile table-${status} ${compact ? "compact" : ""}`}
    >
      <div className="table-tile-top">
        <span>{table.name}</span>
        <span className="table-seat-label">{table.seats} seats</span>
      </div>
      <div className="table-outline">
        <span className="chair chair-top" />
        <span className="chair chair-bottom" />
        <span className="chair chair-left" />
        <span className="chair chair-right" />
        {instance ? <Ticket size={22} /> : <UtensilsCrossed size={21} />}
      </div>
      <div className="table-tile-bottom">
        <span>
          {instance
            ? "Reward active"
            : session?.blocked
              ? "Blocked"
              : redeemed
                ? "Redeemed"
                : session
                  ? "Dining"
                  : "Available"}
        </span>
        {instance ? (
          <Countdown expiresAt={instance.expiresAt} />
        ) : (
          <small>{session ? money(bill(data, session.id)) : "—"}</small>
        )}
      </div>
    </Link>
  );
}
export function Dashboard() {
  const { data, now } = usePulse();
  const [period, setPeriod] = useState("today");
  const cutoff = now - (period === "week" ? 7 : 1) * 86400000,
    rows = data.redemptions.filter(
      (r) => new Date(r.createdAt).getTime() >= cutoff,
    ),
    instances = data.instances.filter(
      (i) => new Date(i.createdAt).getTime() >= cutoff,
    ),
    active = data.instances.filter(
      (i) => i.status === "active" && new Date(i.expiresAt).getTime() > now,
    ),
    sessions = data.sessions.filter((s) => !s.closedAt),
    revenue = rows.reduce((n, r) => n + r.revenue, 0),
    gp = rows.reduce((n, r) => n + r.profit, 0),
    rate = instances.length
      ? Math.round((rows.length / instances.length) * 100)
      : 0,
    discount = rows.reduce((n, r) => n + r.discount, 0);
  const date = new Intl.DateTimeFormat("en-SG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(now);
  return (
    <>
      <PageHeading
        eyebrow="THE SUNDAY SOCIAL"
        title="A little extra. A better service."
        description={date}
      >
        <label className="period-select">
          <CalendarDays size={16} />
          <select
            aria-label="Reporting period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="today">Last 24 hours</option>
            <option value="week">Last 7 days</option>
          </select>
        </label>
        <Link href="/simulator" className="button primary">
          <Plus size={17} /> Add an order
        </Link>
      </PageHeading>
      <div className="service-banner">
        <div>
          <span className="live-dot" />
          <strong>
            {data.settings.paused
              ? "Campaigns paused"
              : "Your floor is in good hands"}
          </strong>
          <span>
            {sessions.length} active tables ·{" "}
            {data.offers.filter((o) => o.enabled).length} campaigns ready to
            reward the right moment.
          </span>
        </div>
        <Link href="/settings">
          <ShieldCheck size={15} /> Profit guardrails on{" "}
          <ArrowUpRight size={14} />
        </Link>
      </div>
      <section className="metrics-grid" aria-label="Venue performance">
        <Metric
          label="Active tables"
          value={`${sessions.length}`}
          suffix={`/ ${data.tables.length}`}
          icon={Armchair}
          foot={`${data.tables.length - sessions.length} tables available`}
        />
        <Metric
          label="Active flash offers"
          value={`${active.length}`}
          icon={Ticket}
          foot={`${instances.length} rewards unlocked this period`}
        />
        <Metric
          label="Reward revenue"
          value={money(revenue)}
          icon={Coins}
          foot={`${rows.length} incremental purchases recorded`}
        />
        <Metric
          label="Est. incremental gross profit"
          value={money(gp)}
          icon={TrendingUp}
          dark
          foot={`After ${money(discount)} in discount cost`}
        />
      </section>
      <div className="dashboard-charts">
        <section className="card performance-card">
          <div className="card-heading">
            <div>
              <h2>Small rewards. Real returns.</h2>
              <p>Revenue and estimated profit from redeemed rewards</p>
            </div>
            <span className="muted-chip">
              {period === "today" ? "This service" : "Last 7 days"}
            </span>
          </div>
          <div className="chart-summary">
            <strong>{money(gp)}</strong>
            <span>estimated gross profit</span>
            <div className="chart-legend">
              <span>
                <i className="legend-dot green" />
                Gross profit
              </span>
              <span>
                <i className="legend-dot peach" />
                Revenue
              </span>
            </div>
          </div>
          <ServiceChart state={data} period={period} />
        </section>
        <section className="card conversion-card">
          <div className="card-heading">
            <div>
              <h2>Reward conversion</h2>
              <p>A nudge that earns its place</p>
            </div>
            <Info size={16} className="muted" />
          </div>
          <div className="conversion-body">
            <div
              className="donut"
              style={{
                background: `conic-gradient(#357257 ${rate}%, #edf1ec 0)`,
              }}
            >
              <div>
                <strong>
                  {rate}
                  <small>%</small>
                </strong>
                <span>redeemed</span>
              </div>
            </div>
            <div className="conversion-numbers">
              <span>
                <i className="legend-dot green" />
                Redeemed <b>{rows.length}</b>
              </span>
              <span>
                <i className="legend-dot gray" />
                Not redeemed{" "}
                <b>{Math.max(0, instances.length - rows.length)}</b>
              </span>
            </div>
          </div>
          <div className="conversion-footer">
            <ShieldCheck size={16} />
            <span>
              {
                data.decisions.filter((d) =>
                  d.reasons.some((r) => /30-day|60 days/.test(r)),
                ).length
              }{" "}
              decisions protected by frequency caps
            </span>
          </div>
        </section>
      </div>
      <section className="card floor-card">
        <div className="card-heading">
          <div>
            <h2>
              Your floor, right now{" "}
              <span className="small-count">{data.tables.length} tables</span>
            </h2>
            <p>Every table is an opportunity. Every reward has a reason.</p>
          </div>
          <Link href="/tables" className="text-link">
            Manage tables <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="floor-legend">
          <span>
            <i className="legend-dot peach" />
            Reward active
          </span>
          <span>
            <i className="legend-dot green" />
            Dining
          </span>
          <span>
            <i className="legend-dot gray" />
            Available
          </span>
          <span className="zone-label">MAIN FLOOR + TERRACE</span>
        </div>
        <div className="floor-grid">
          {data.tables.map((t) => (
            <TableTile key={t.id} table={t} compact />
          ))}
        </div>
      </section>
      <div className="dashboard-bottom">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>
                Live rewards{" "}
                <span className="small-count">{active.length}</span>
              </h2>
              <p>One per table, for this bill only</p>
            </div>
            <Link href="/offers" className="text-link">
              View campaigns <ArrowUpRight size={15} />
            </Link>
          </div>
          {active.length ? (
            active.slice(0, 3).map((i) => {
              const offer = data.offers.find((o) => o.id === i.offerId)!,
                session = data.sessions.find((s) => s.id === i.sessionId)!,
                table = data.tables.find((t) => t.id === session.tableId)!;
              return (
                <Link
                  href={`/tables?table=${table.id}`}
                  className="reward-row"
                  key={i.id}
                >
                  <span className="reward-row-icon">
                    <Ticket size={20} />
                  </span>
                  <div>
                    <strong>{offer.name}</strong>
                    <span>
                      {table.name} · {offerLabels[offer.kind]}
                    </span>
                  </div>
                  <span className="reward-profit">
                    +{money(i.projectedProfit)}
                    <small>projected profit</small>
                  </span>
                  <Countdown expiresAt={i.expiresAt} />
                </Link>
              );
            })
          ) : (
            <Empty>
              No active rewards. Qualifying organic orders create the next
              opportunity.
            </Empty>
          )}
        </section>
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>The decision feed</h2>
              <p>Nothing random about your guardrails</p>
            </div>
            <Link href="/activity" className="text-link">
              View all <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="decision-feed">
            {data.decisions
              .slice(-3)
              .reverse()
              .map((d) => {
                const session = data.sessions.find((s) => s.id === d.sessionId),
                  table = data.tables.find((t) => t.id === session?.tableId);
                return (
                  <div className="decision-row" key={d.id}>
                    <span
                      className={`decision-icon ${d.outcome === "shown" ? "positive" : ""}`}
                    >
                      {d.outcome === "shown" ? (
                        <Check size={16} />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {table?.name}{" "}
                        <span>
                          {d.outcome === "shown"
                            ? "Reward unlocked"
                            : d.outcome === "control"
                              ? "Control table"
                              : "Reward withheld"}
                        </span>
                      </strong>
                      <p>{d.reasons[0]}</p>
                    </div>
                    <time>
                      {new Intl.DateTimeFormat("en-SG", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                        timeZone: "Asia/Singapore",
                      }).format(new Date(d.createdAt))}
                    </time>
                  </div>
                );
              })}
            {!data.decisions.length && (
              <Empty>Decisions will appear when orders arrive.</Empty>
            )}
          </div>
        </section>
      </div>
      <div className="demo-callout">
        <span className="demo-callout-icon">
          <Monitor size={20} />
        </span>
        <div>
          <strong>See the other side of the table.</strong>
          <span>
            Open a mini-screen or send a demo order to watch a reward unlock.
          </span>
        </div>
        <Link
          href={`/display/${data.displayTokens[sessions[0]?.id] ?? ""}`}
          className="button secondary"
        >
          Preview a screen <ArrowUpRight size={15} />
        </Link>
        <Link href="/simulator" className="text-link">
          Try the simulator <ArrowUpRight size={15} />
        </Link>
      </div>
    </>
  );
}
function Metric({
  label,
  value,
  suffix,
  icon: Icon,
  foot,
  dark = false,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: typeof Armchair;
  foot: string;
  dark?: boolean;
}) {
  return (
    <article className={`metric-card ${dark ? "metric-dark" : ""}`}>
      <div className="metric-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <div className="metric-value">
        {value}
        <small>{suffix}</small>
      </div>
      <div className="metric-foot">
        {dark ? (
          <TrendingUp size={13} />
        ) : (
          <span className="metric-foot-dash" />
        )}
        {foot}
      </div>
    </article>
  );
}
