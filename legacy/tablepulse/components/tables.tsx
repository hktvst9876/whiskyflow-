"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Monitor, ShieldCheck, Ticket, ArrowUpRight } from "lucide-react";
import { PageHeading, usePulse, Modal, Empty } from "./workspace";
import { TableTile, Countdown } from "./dashboard";
import { OrderComposer } from "./simulator";
import { money, type Session } from "@/lib/types";
import { bill, currentOrders } from "@/lib/basket";
export function TablesView() {
  const { data, now, mutate, busy, notify } = usePulse();
  const [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<string>(),
    [compose, setCompose] = useState(false),
    [closeConfirm, setCloseConfirm] = useState(false),
    [code, setCode] = useState(""),
    [cancelReason, setCancelReason] = useState(""),
    [override, setOverride] = useState(false),
    [overrideId, setOverrideId] = useState(data.offers[0]?.id ?? ""),
    [reason, setReason] = useState("");
  useEffect(() => {
    setSelected(
      new URLSearchParams(window.location.search).get("table") ?? undefined,
    );
  }, []);
  const [customerRef, setCustomerRef] = useState("");
  const [memberCode, setMemberCode] = useState("");
  const session = data.sessions.find(
      (s) => s.tableId === selected && !s.closedAt,
    ),
    table = data.tables.find((t) => t.id === selected),
    instance = session
      ? data.instances.find(
          (i) =>
            i.sessionId === session.id &&
            i.status === "active" &&
            new Date(i.expiresAt).getTime() > now,
        )
      : undefined,
    offer = data.offers.find((o) => o.id === instance?.offerId),
    orders = session ? currentOrders(data, session.id) : [];
  function select(id: string) {
    setSelected(id);
    setCode("");
    setCustomerRef("");
    setMemberCode("");
    setCancelReason("");
    setCompose(false);
    setOverride(false);
    setCloseConfirm(false);
  }
  async function flags(s: Session, patch: Partial<Session>) {
    try {
      await mutate({
        action: "flags",
        sessionId: s.id,
        ageVerified: s.ageVerified,
        intoxicated: s.intoxicated,
        blocked: s.blocked,
        ...patch,
      });
      notify("Table safety updated.");
    } catch {}
  }
  const visible = data.tables.filter((t) => {
    const s = data.sessions.find((s) => s.tableId === t.id && !s.closedAt);
    if (filter === "available") return !s;
    if (filter === "rewards")
      return (
        !!s &&
        data.instances.some(
          (i) =>
            i.sessionId === s.id &&
            i.status === "active" &&
            new Date(i.expiresAt).getTime() > now,
        )
      );
    return filter === "all" || !!s;
  });
  return (
    <>
      <PageHeading
        eyebrow="FLOOR OPERATIONS"
        title="Every table, in the moment."
        description="Manage current bills, verify guests, and redeem table rewards."
      >
        <Link href="/simulator" className="button primary">
          <Plus size={17} /> Add an order
        </Link>
      </PageHeading>
      <div className="section-toolbar">
        <div className="segmented">
          {["all", "dining", "rewards", "available"].map((f) => (
            <button
              key={f}
              className={filter === f ? "active" : ""}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "All tables"
                : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className="muted">
          {data.sessions.filter((s) => !s.closedAt).length} active visits ·{" "}
          {data.tables.length} tables
        </span>
      </div>
      <div className="table-list">
        {visible.map((t) => (
          <div
            key={t.id}
            onClick={(e) => {
              e.preventDefault();
              select(t.id);
            }}
          >
            <TableTile table={t} />
          </div>
        ))}
      </div>
      {!visible.length && <Empty>No tables match this view.</Empty>}
      {table && (
        <Modal
          title={`${table.name} · ${table.zone}`}
          onClose={() => setSelected(undefined)}
        >
          {!session ? (
            <>
              <Empty>This table is available for a new visit.</Empty>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  try {
                    await mutate({ action: "session", tableId: table.id });
                    notify(`${table.name} visit opened.`);
                  } catch {}
                }}
              >
                Open table session
              </button>
            </>
          ) : compose ? (
            <OrderComposer
              sessionId={session.id}
              onSent={() => setCompose(false)}
            />
          ) : (
            <>
              <div className="table-detail-grid">
                <div className="detail-box">
                  <span>Current bill</span>
                  <strong>{money(bill(data, session.id))}</strong>
                </div>
                <div className="detail-box">
                  <span>Visit time</span>
                  <strong>
                    {Math.max(
                      0,
                      Math.floor(
                        (now - new Date(session.startedAt).getTime()) / 60000,
                      ),
                    )}{" "}
                    <small>min</small>
                  </strong>
                </div>
              </div>
              <div className="safety-fields">
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={session.ageVerified}
                    disabled={busy}
                    onChange={(e) =>
                      flags(session, { ageVerified: e.target.checked })
                    }
                  />{" "}
                  All guests receiving alcohol are verified 18+
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={session.intoxicated}
                    disabled={busy}
                    onChange={(e) =>
                      flags(session, { intoxicated: e.target.checked })
                    }
                  />{" "}
                  Flag intoxication — block alcohol promotions
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={session.blocked}
                    disabled={busy}
                    onChange={(e) =>
                      flags(session, { blocked: e.target.checked })
                    }
                  />{" "}
                  Block all rewards for this visit
                </label>
              </div>
              {session.customerVerified ? (
                <div className="tag" style={{ marginBottom: 16 }}>
                  <ShieldCheck size={13} />
                  {session.membershipId
                    ? `Member ${session.membershipId} linked`
                    : "Verified POS customer linked"}
                </div>
              ) : (
                <form
                  style={{ marginBottom: 18 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await mutate({
                        action: "link_customer",
                        sessionId: session.id,
                        customerRef,
                      });
                      setCustomerRef("");
                      notify("Verified customer reference linked.");
                    } catch {}
                  }}
                >
                  <label className="form-field">
                    POS customer reference
                    <small>
                      Enter the guest’s verified loyalty account reference.
                      Never shown on the screen.
                    </small>
                    <div className="redemption-form" style={{ marginTop: 0 }}>
                      <input
                        aria-label="POS customer reference"
                        value={customerRef}
                        onChange={(e) => setCustomerRef(e.target.value)}
                        minLength={3}
                        maxLength={128}
                        required
                      />
                      <button
                        className="button secondary"
                        disabled={busy || customerRef.length < 3}
                      >
                        Link customer
                      </button>
                    </div>
                  </label>
                </form>
              )}
              {!session.customerVerified && (
                <form
                  className="member-staff-checkin"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await mutate({
                        action: "confirm_member",
                        sessionId: session.id,
                        code: memberCode,
                      });
                      setMemberCode("");
                      notify(
                        "Member confirmed for this visit. The next organic order can qualify.",
                      );
                    } catch {}
                  }}
                >
                  <label className="form-field">
                    Confirm member check-in
                    <small>
                      Ask the guest to scan the screen QR, verify their phone,
                      and show their five-minute check-in code. Confirm they are
                      at this table.
                    </small>
                    <div className="redemption-form">
                      <input
                        aria-label="Member check-in code"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={memberCode}
                        onChange={(e) =>
                          setMemberCode(e.target.value.replace(/\D/g, ""))
                        }
                        placeholder="6-digit check-in code"
                        required
                      />
                      <button
                        className="button secondary"
                        disabled={busy || memberCode.length !== 6}
                      >
                        Confirm member
                      </button>
                    </div>
                  </label>
                  <Link
                    href={`/member?token=${encodeURIComponent(data.displayTokens[session.id])}`}
                    className="text-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open customer check-in
                  </Link>
                </form>
              )}
              <h3>Orders on this bill</h3>
              <div className="order-history">
                {orders.map((o) => (
                  <div className="order-record" key={o.id}>
                    <div className="order-record-top">
                      <small>
                        {new Intl.DateTimeFormat("en-SG", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Asia/Singapore",
                        }).format(new Date(o.createdAt))}{" "}
                        · {o.organic ? "Organic order" : "Reward purchase"}
                      </small>
                      {o.organic && (
                        <button
                          className="inline-button"
                          disabled={busy}
                          onClick={async () => {
                            try {
                              await mutate({ action: "void", orderId: o.id });
                              notify(
                                "Order voided; affected rewards cancelled.",
                              );
                            } catch {}
                          }}
                        >
                          Void order
                        </button>
                      )}
                    </div>
                    <p>
                      {o.items
                        .map(
                          (i) =>
                            `${i.quantity} × ${data.menu.find((m) => m.id === i.menuItemId)?.name}`,
                        )
                        .join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
              {!orders.length && (
                <Empty>No orders yet. Rewards require an organic order.</Empty>
              )}
              {instance && offer ? (
                <div className="reward-detail">
                  <div className="section-toolbar" style={{ marginBottom: 8 }}>
                    <h3>{offer.name}</h3>
                    <Countdown expiresAt={instance.expiresAt} />
                  </div>
                  <p>
                    {offer.quantity} ×{" "}
                    {data.menu.find((m) => m.id === offer.itemId)?.name} at{" "}
                    {money(offer.price)} each
                  </p>
                  <span className="code-label">{instance.code}</span>
                  <p style={{ fontSize: 11 }}>
                    One per table · Current bill only · Not stackable
                  </p>
                  <form
                    className="redemption-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await mutate({
                          action: "redeem",
                          sessionId: session.id,
                          code,
                        });
                        setCode("");
                        notify(
                          "Reward redeemed and added to the current bill.",
                        );
                      } catch {}
                    }}
                  >
                    <input
                      aria-label="Staff redemption code"
                      placeholder="6-character code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      maxLength={6}
                      required
                    />
                    <button
                      className="button copper"
                      disabled={busy || code.length !== 6}
                    >
                      Redeem
                    </button>
                  </form>
                  <div className="redemption-form">
                    <input
                      aria-label="Cancellation reason"
                      placeholder="Reason for cancellation"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                    />
                    <button
                      className="button secondary"
                      disabled={busy || cancelReason.length < 3}
                      onClick={async () => {
                        try {
                          await mutate({
                            action: "cancel",
                            instanceId: instance.id,
                            reason: cancelReason,
                          });
                          notify(
                            "Reward cancelled. No replacement will be allocated.",
                          );
                        } catch {}
                      }}
                    >
                      Cancel reward
                    </button>
                  </div>
                </div>
              ) : (
                <div className="notice">
                  <ShieldCheck size={17} />
                  <span>
                    {session.offerReceived
                      ? "This visit already received its one reward."
                      : session.control
                        ? "This visit is in the control cohort."
                        : session.blocked
                          ? "Rewards are blocked for this table."
                          : "The next organic order will be evaluated for a reward."}
                  </span>
                </div>
              )}
              {override && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      const result = await mutate({
                        action: "override",
                        sessionId: session.id,
                        offerId: overrideId,
                        reason,
                      });
                      notify(
                        result.decision.outcome === "shown"
                          ? "Eligible override allocated."
                          : result.decision.reasons[0],
                      );
                      setOverride(false);
                    } catch {}
                  }}
                  style={{ display: "grid", gap: 12, marginTop: 20 }}
                >
                  <label className="form-field">
                    Select an eligible campaign
                    <select
                      value={overrideId}
                      onChange={(e) => setOverrideId(e.target.value)}
                    >
                      {data.offers.map((o) => (
                        <option value={o.id} key={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    Override reason
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={3}
                      required
                    />
                  </label>
                  <small className="muted">
                    Safety checks, control cohort, random allocation and margin
                    floors cannot be overridden.
                  </small>
                  <button className="button secondary" disabled={busy}>
                    Evaluate override
                  </button>
                </form>
              )}
              {closeConfirm ? (
                <div className="notice">
                  <span>
                    Closing this bill ends the display session and cancels
                    pending rewards.
                  </span>
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await mutate({
                          action: "close",
                          sessionId: session.id,
                        });
                        setSelected(undefined);
                        notify("Bill closed. Screen token revoked.");
                      } catch {}
                    }}
                  >
                    Confirm close
                  </button>
                </div>
              ) : (
                <div className="detail-actions">
                  <button
                    className="button primary"
                    onClick={() => setCompose(true)}
                  >
                    <Plus size={15} />
                    Add order
                  </button>
                  <Link
                    href={`/display/${data.displayTokens[session.id]}`}
                    className="button secondary"
                    target="_blank"
                  >
                    <Monitor size={15} />
                    Open screen
                  </Link>
                  {!session.offerReceived && (
                    <button
                      className="button secondary"
                      onClick={() => setOverride(!override)}
                    >
                      Override
                    </button>
                  )}
                  <button
                    className="button danger"
                    onClick={() => setCloseConfirm(true)}
                  >
                    Close bill
                  </button>
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
