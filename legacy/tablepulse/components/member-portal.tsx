"use client";
import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import {
  Activity,
  ShieldCheck,
  Smartphone,
  Ticket,
  ArrowRight,
  LogOut,
} from "lucide-react";
import { money, type Category } from "@/lib/types";

type View = {
  mode: "demo" | "live";
  venue: string;
  member: {
    membershipId: string;
    optedIn: boolean;
    preferences: Category[];
    createdAt: string;
  } | null;
  visits?: {
    table: string;
    startedAt: string;
    closed: boolean;
    billTotal: number;
  }[];
  rewardsUsed?: number;
};
type Checkin = {
  checkinCode?: string;
  expiresAt?: string;
  table?: string;
  confirmed?: boolean;
};
type Captcha = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    hcaptcha?: Captcha;
  }
}
const options: { id: Category; label: string }[] = [
  { id: "food", label: "Food" },
  { id: "snack", label: "Snacks & sides" },
  { id: "zero_alcohol", label: "Zero-alcohol" },
  { id: "beer", label: "Beer" },
  { id: "wine", label: "Wine" },
  { id: "cocktail", label: "Cocktails" },
];

export function MemberPortal() {
  const [view, setView] = useState<View>(),
    [phone, setPhone] = useState("+65 "),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState<{
      challengeId?: string;
      demoCode?: string;
    }>(),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(""),
    [checkin, setCheckin] = useState<Checkin>(),
    [optedIn, setOptedIn] = useState(false),
    [preferences, setPreferences] = useState<Category[]>([]),
    [captchaToken, setCaptchaToken] = useState(""),
    [captchaReady, setCaptchaReady] = useState(false),
    [resendAt, setResendAt] = useState(0),
    [now, setNow] = useState(0);
  const captchaElement = useRef<HTMLDivElement>(null),
    captchaId = useRef<string | undefined>(undefined);
  const sitekey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
  async function refresh() {
    const res = await fetch("/api/member", { cache: "no-store" }),
      value = await res.json();
    if (!res.ok) throw new Error(value.error);
    setView(value);
    setOptedIn(value.member?.optedIn ?? false);
    setPreferences(value.member?.preferences ?? []);
  }
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
    setNow(Date.now());
    void refresh().catch((e) => setError(e.message));
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (
      view?.mode !== "live" ||
      view.member ||
      challenge ||
      !sitekey ||
      !captchaReady ||
      !window.hcaptcha ||
      !captchaElement.current
    )
      return;
    captchaId.current = window.hcaptcha.render(captchaElement.current, {
      sitekey,
      callback: setCaptchaToken,
      "expired-callback": () => setCaptchaToken(""),
    });
    return () => {
      if (captchaId.current) window.hcaptcha?.remove(captchaId.current);
      captchaId.current = undefined;
    };
  }, [view?.mode, !!view?.member, !!challenge, sitekey, captchaReady]);
  async function send(payload: unknown) {
    const res = await fetch("/api/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const seconds = checkin?.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(checkin.expiresAt) - now) / 1000))
    : 0;
  return (
    <main className="member-page">
      {view?.mode === "live" && sitekey && (
        <Script
          src="https://js.hcaptcha.com/1/api.js?render=explicit"
          strategy="afterInteractive"
          onReady={() => setCaptchaReady(true)}
          onError={() =>
            setError(
              "Security check could not load. Please retry with a connection.",
            )
          }
        />
      )}
      <div className="member-wrap">
        <a href="/member" className="member-logo">
          <Activity size={24} /> TablePulse<span>MEMBERS</span>
        </a>
        <section className="member-card">
          <div className="member-eyebrow">{view?.venue ?? "YOUR VENUE"}</div>
          {!view ? (
            <>
              <h1>Connecting your account.</h1>
              <p>One moment while we connect to the venue.</p>
            </>
          ) : !view.member ? (
            <>
              <div className="member-icon">
                <Smartphone size={27} />
              </div>
              <h1>
                A familiar face.
                <br />A little extra, occasionally.
              </h1>
              <p>
                Sign in on your own phone. Your membership number stays with
                you, and your details stay off the table screen.
              </p>
              {view.mode === "demo" && (
                <div className="member-notice">
                  <b>Demo verification</b>
                  <br />
                  No SMS is sent. Use a fictional number; a temporary test code
                  will appear here. This mode is not identity verification.
                </div>
              )}
              {!challenge ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      const result = await send({
                        action: "request_otp",
                        phone,
                        captchaToken,
                      });
                      setChallenge(result);
                      setCode("");
                      setResendAt(Date.now() + 60000);
                      setCaptchaToken("");
                    });
                  }}
                >
                  <label className="form-field">
                    Phone number
                    <input
                      type="tel"
                      autoComplete="tel"
                      placeholder="+65 8123 4567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      maxLength={30}
                      required
                    />
                  </label>
                  {view.mode === "live" && sitekey && (
                    <div ref={captchaElement} className="member-captcha" />
                  )}
                  <button
                    className="button primary member-wide"
                    disabled={
                      busy ||
                      (view.mode === "live" && !!sitekey && !captchaToken) ||
                      now < resendAt
                    }
                  >
                    {busy ? "Requesting…" : "Send verification code"}
                    <ArrowRight size={17} />
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      await send({
                        action: "verify_otp",
                        phone,
                        code,
                        challengeId: challenge.challengeId,
                      });
                      setChallenge(undefined);
                      await refresh();
                    });
                  }}
                >
                  <p className="member-phone">
                    Code requested for <b>{phone}</b>
                  </p>
                  {challenge.demoCode && (
                    <div className="member-notice">
                      Your temporary demo code:{" "}
                      <strong>{challenge.demoCode}</strong>
                    </div>
                  )}
                  <label className="form-field">
                    Verification code
                    <input
                      aria-label="Verification code"
                      className="member-otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, ""))
                      }
                      maxLength={6}
                      required
                      autoFocus
                    />
                  </label>
                  <button
                    className="button primary member-wide"
                    disabled={busy || code.length !== 6}
                  >
                    {busy ? "Verifying…" : "Verify & sign in"}
                    <ShieldCheck size={17} />
                  </button>
                  <button
                    type="button"
                    className="inline-button"
                    disabled={busy}
                    onClick={() => {
                      setChallenge(undefined);
                      setCode("");
                      setError("");
                    }}
                  >
                    Change number or request again
                    {now < resendAt
                      ? ` (${Math.ceil((resendAt - now) / 1000)}s)`
                      : ""}
                  </button>
                </form>
              )}
              <p className="member-privacy">
                We use your verified number to sign you in and recognise your
                account. Creating an account does not unlock a reward or enrol
                you in marketing. Choose optional personalisation after sign-in.{" "}
                <a href="#member-privacy">How your data is used</a>
              </p>
            </>
          ) : (
            <>
              <div className="member-top">
                <span className="tag">
                  <ShieldCheck size={14} />
                  {view.mode === "demo" ? "Demo account" : "Phone verified"}
                </span>
                <button
                  className="inline-button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await send({ action: "logout" });
                      setCheckin(undefined);
                      await refresh();
                    })
                  }
                >
                  <LogOut size={15} /> Sign out
                </button>
              </div>
              <h1>
                Your good moments,
                <br />
                in one place.
              </h1>
              <div className="member-pass">
                <Ticket size={24} />
                <span>Your membership number</span>
                <strong>{view.member.membershipId}</strong>
                <small>
                  This is a reference, not a password or reward code.
                </small>
              </div>
              {token ? (
                <div className="member-checkin">
                  <h2>Here for a visit?</h2>
                  {checkin?.confirmed ? (
                    <p>
                      <ShieldCheck size={16} /> Your membership is confirmed at{" "}
                      {checkin.table}. Rewards still require a qualifying
                      organic order.
                    </p>
                  ) : checkin?.checkinCode && seconds > 0 ? (
                    <>
                      <p>
                        Show this code to your server at <b>{checkin.table}</b>.
                        Staff will confirm you are at the table.
                      </p>
                      <div className="member-checkin-code">
                        {checkin.checkinCode}
                      </div>
                      <small>
                        Expires in {Math.floor(seconds / 60)}:
                        {String(seconds % 60).padStart(2, "0")} · check-in only
                      </small>
                      <button
                        className="button secondary member-wide"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const result = await send({
                              action: "checkin_status",
                              token,
                            });
                            if (result.confirmed) {
                              setCheckin(result);
                              await refresh();
                            } else
                              setMessage(
                                "Your server has not confirmed this code yet.",
                              );
                          })
                        }
                      >
                        Check confirmation
                      </button>
                    </>
                  ) : (
                    <>
                      <p>
                        Link this visit to your membership with your server's
                        confirmation.
                      </p>
                      <button
                        className="button primary member-wide"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            setCheckin(
                              await send({ action: "checkin", token }),
                            );
                          })
                        }
                      >
                        Get table check-in code
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <p className="member-notice">
                  Scan the QR on your table screen to check in for your current
                  visit.
                </p>
              )}
              <form
                className="member-preferences"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await send({ action: "preferences", optedIn, preferences });
                    await refresh();
                    setMessage("Your preferences have been saved.");
                  });
                }}
              >
                <h2>Make it feel more like you.</h2>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={optedIn}
                    onChange={(e) => setOptedIn(e.target.checked)}
                  />{" "}
                  I agree to use my preferences and linked visit history,
                  including AI-based offer ranking when enabled, for
                  personalised venue rewards.
                </label>
                <p className="member-privacy">
                  Optional. Turn this off any time. Rewards are occasional,
                  capped and require a new qualifying purchase. Alcohol offers
                  require staff age and safety checks.
                </p>
                <div className="member-preference-grid">
                  {options.map((o) => (
                    <label
                      key={o.id}
                      className={`member-preference ${preferences.includes(o.id) && optedIn ? "selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!optedIn}
                        checked={preferences.includes(o.id)}
                        onChange={(e) =>
                          setPreferences(
                            e.target.checked
                              ? [...preferences, o.id]
                              : preferences.filter((p) => p !== o.id),
                          )
                        }
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
                <button
                  className="button secondary member-wide"
                  disabled={busy}
                >
                  Save preferences
                </button>
              </form>
              <section className="member-visits">
                <h2>Your linked visits</h2>
                <p className="member-privacy">
                  These are associated table bills, which may include other
                  guests' purchases. They do not represent your individual
                  consumption.
                </p>
                {view.visits?.length ? (
                  view.visits.map((v, i) => (
                    <div className="member-visit" key={i}>
                      <div>
                        <b>{v.table}</b>
                        <span>
                          {new Date(v.startedAt).toLocaleDateString("en-SG", {
                            timeZone: "Asia/Singapore",
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}{" "}
                          · {v.closed ? "Completed" : "Current visit"}
                        </span>
                      </div>
                      <strong>{money(v.billTotal)}</strong>
                    </div>
                  ))
                ) : (
                  <p>No confirmed visits yet.</p>
                )}
              </section>
            </>
          )}
          {error && (
            <div className="member-error" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="member-success" role="status">
              {message}
            </div>
          )}
        </section>
        <section id="member-privacy" className="member-privacy-note">
          <ShieldCheck size={20} />
          <div>
            <h2>Your account, privately.</h2>
            <p>
              Only confirmed visits link to this venue's account. Your number
              and history are never displayed on the shared screen. If the venue
              enables AI personalisation, its provider receives approved offer
              choices, current basket categories and only opted-in category
              summaries—not your phone number, name or raw bill history. Opting
              out stops personalisation; account, transaction and reward audit
              records remain for operations and abuse prevention. Ask the venue
              about account access, deletion, retention or changing your number.
              No promotional SMS or WhatsApp enrolment is included.
            </p>
          </div>
        </section>
        <footer className="member-footer">
          One table. One opportunity. A pleasant surprise.
        </footer>
      </div>
    </main>
  );
}
