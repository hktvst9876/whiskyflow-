"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Ticket,
  ShieldCheck,
  Clock,
  Activity,
  UtensilsCrossed,
} from "lucide-react";
import { money } from "@/lib/types";
type ScreenData = {
  venue: string;
  table: string;
  offer: {
    title: string;
    item: string;
    price: number;
    quantity: number;
    alcohol: boolean;
    code: string;
    expiresAt: string;
  } | null;
  highlights: { name: string; price: number }[];
  enrolled: boolean;
};
export function PublicScreen({ token }: { token: string }) {
  const [data, setData] = useState<ScreenData>(),
    [now, setNow] = useState(Date.now()),
    [error, setError] = useState(""),
    [origin, setOrigin] = useState(""),
    [enrol, setEnrol] = useState(false);
  useEffect(() => {
    setOrigin(window.location.origin);
    setEnrol(new URLSearchParams(window.location.search).has("enrol"));
    let disposed = false,
      lastSuccess = Date.now();
    const load = async () => {
      try {
        const res = await fetch(
            `/api/display?token=${encodeURIComponent(token)}`,
            { cache: "no-store" },
          ),
          value = await res.json();
        if (disposed) return;
        if (!res.ok) {
          setError(value.error);
          setData(undefined);
        } else {
          lastSuccess = Date.now();
          setData(value);
          setError("");
        }
      } catch {
        if (!disposed && Date.now() - lastSuccess > 15000) {
          setError("Connection paused. Please ask your server for assistance.");
          setData(undefined);
        }
      }
    };
    void load();
    const poll = setInterval(load, 3000),
      clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      disposed = true;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [token]);
  if (error)
    return (
      <div className="public-page">
        <div className="public-error">
          <UtensilsCrossed
            size={38}
            style={{ margin: "auto", color: "#b4d08d" }}
          />
          <h1>Enjoy the rest of your visit.</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="public-page">
        <div className="loading-screen">
          <Activity size={32} />
          <span>Connecting your table…</span>
        </div>
      </div>
    );
  if (enrol)
    return (
      <div className="public-page">
        <div className="public-error">
          <ShieldCheck size={30} />
          <h1>Your membership, on your phone.</h1>
          <p>
            Scan to verify your phone and get a permanent membership number.
          </p>
          {origin && (
            <QRCodeSVG
              value={`${origin}/member?token=${encodeURIComponent(token)}`}
              size={160}
              marginSize={2}
              title="Customer membership on your own phone"
            />
          )}
          <button className="button secondary" onClick={() => setEnrol(false)}>
            Back to table screen
          </button>
        </div>
      </div>
    );
  const offer =
      data.offer && new Date(data.offer.expiresAt).getTime() > now
        ? data.offer
        : null,
    sec = offer
      ? Math.max(
          0,
          Math.ceil((new Date(offer.expiresAt).getTime() - now) / 1000),
        )
      : 0;
  return (
    <div className="public-page">
      <div className="public-display">
        <header className="public-header">
          <span className="public-venue">
            {data.venue}
            <span style={{ color: "#bbcd9f" }}> ✳</span>
          </span>
          <span className="public-table">WELCOME TO {data.table}</span>
        </header>
        <main className="public-content">
          <div>
            <div className="public-eyebrow">
              {offer ? <Ticket size={15} /> : <UtensilsCrossed size={15} />}{" "}
              {offer
                ? "A LITTLE EXTRA, JUST FOR THIS TABLE"
                : "GOOD FOOD. GOOD COMPANY."}
            </div>
            <h1>
              {offer ? (
                <>
                  A table reward
                  <br />
                  just unlocked.
                </>
              ) : (
                <>
                  Settle in.
                  <br />
                  You’re in good company.
                </>
              )}
            </h1>
            {offer ? (
              <>
                <p className="public-description">
                  A little something to complement your order.
                  <br />
                  Add{" "}
                  <b>
                    {offer.quantity} × {offer.item}
                  </b>{" "}
                  to your current bill for <b>{money(offer.price)} each.</b>
                </p>
                <div className="public-timer">
                  <Clock size={18} />
                  <strong>
                    {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
                  </strong>
                  <span>remaining for this table</span>
                </div>
              </>
            ) : (
              <>
                <p className="public-description">
                  Some favourites from our kitchen.
                  <br />
                  Ask your server for the full menu.
                </p>
                <div className="public-highlights">
                  {data.highlights.map((m) => (
                    <div key={m.name}>
                      <span>{m.name}</span>
                      <strong>{money(m.price)}</strong>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <aside className="public-card">
            {offer ? (
              <>
                <Ticket size={27} color="#a57a47" />
                <div className="offer-item">
                  {offer.quantity} × {offer.item}
                </div>
                <div className="public-price">
                  {money(offer.price * offer.quantity)}
                </div>
                <small>Total reward purchase · ask your server</small>
                <div className="public-code">{offer.code}</div>
                <small>Show this code to your server at this table.</small>
                {origin && (
                  <div className="public-member-qr">
                    <QRCodeSVG
                      value={`${origin}/member?token=${encodeURIComponent(token)}`}
                      size={64}
                      marginSize={1}
                      title="Member check-in"
                    />
                    <small>
                      Already a member?
                      <br />
                      Scan on your own phone.
                    </small>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="offer-item">
                  A little extra for
                  <br />
                  your next good moment.
                </div>
                {origin && (
                  <QRCodeSVG
                    value={`${origin}/member?token=${encodeURIComponent(token)}`}
                    size={128}
                    fgColor="#264a32"
                    bgColor="#f4f2e7"
                    marginSize={1}
                    title="Optional rewards enrolment"
                  />
                )}
                <small>
                  Scan on your phone to join or check in.
                  <br />
                  No purchase history on screen.
                </small>
              </>
            )}
          </aside>
        </main>
        <footer className="public-footer">
          <span>
            <ShieldCheck size={14} />
            {offer
              ? "One per table · Current bill only · Not stackable"
              : "Optional rewards · Always a pleasant surprise"}
          </span>
          <span>
            {offer?.alcohol
              ? "Enjoy responsibly. Alcohol rewards are for verified adults only."
              : "Your table. Your moment. Enjoy your visit."}
          </span>
          <span className="public-brand">
            <Activity size={12} />
            TablePulse
          </span>
        </footer>
      </div>
    </div>
  );
}
