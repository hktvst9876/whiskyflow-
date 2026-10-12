"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import {
  Activity,
  LayoutDashboard,
  Armchair,
  Ticket,
  UtensilsCrossed,
  ChartNoAxesCombined,
  FlaskConical,
  Settings,
  ChevronDown,
  Bell,
  ArrowUpRight,
  PanelLeftClose,
  Menu,
  LogOut,
  X,
  ShieldCheck,
  Radio,
  Check,
  HelpCircle,
} from "lucide-react";
import type { Snapshot } from "@/lib/types";
import { useVenueTools } from "./webmcp";
type PulseContext = {
  data: Snapshot;
  now: number;
  refresh: () => Promise<void>;
  mutate: (body: unknown, endpoint?: string) => Promise<any>;
  busy: boolean;
  notify: (message: string) => void;
};
const Context = createContext<PulseContext | null>(null);
export function usePulse() {
  const value = useContext(Context);
  if (!value) throw new Error("Pulse provider missing");
  return value;
}
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`brand ${light ? "brand-light" : ""}`}>
      <span className="brand-mark">
        <Activity size={23} strokeWidth={2.2} />
      </span>
      <span>
        Table<span className="brand-lightweight">Pulse</span>
        <span className="brand-period">.</span>
      </span>
    </span>
  );
}
const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/tables", label: "Tables & orders", icon: Armchair },
  { href: "/offers", label: "Flash offers", icon: Ticket },
  { href: "/menu", label: "Menu & inventory", icon: UtensilsCrossed },
  { href: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { href: "/activity", label: "Activity log", icon: Activity },
];
export function WorkspaceShell({
  initial,
  children,
}: {
  initial: Snapshot;
  children: React.ReactNode;
}) {
  const [data, setData] = useState(initial),
    [now, setNow] = useState(initial.serverTime),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [notifications, setNotifications] = useState(false),
    [roles, setRoles] = useState(false);
  useVenueTools(data);
  const path = usePathname();
  const busyRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (response.ok) setData(await response.json());
      else if (response.status === 401) window.location.href = "/login";
    } catch {
      /* Keep the last snapshot; the next poll retries. */
    }
  }, []);
  const mutate = useCallback(
    async (body: unknown, endpoint = "/api/commands") => {
      if (busyRef.current)
        throw new Error("Please wait for the current action");
      busyRef.current = true;
      setBusy(true);
      try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
          result = await response.json();
        await refresh();
        if (!response.ok)
          throw new Error(
            result.error ??
              result.reasons?.join("; ") ??
              "Action could not be completed",
          );
        return result;
      } catch (error) {
        notify((error as Error).message);
        throw error;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refresh, notify],
  );
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000),
      poll = setInterval(refresh, 6000);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [refresh]);
  useEffect(() => {
    if (initial.mode === "demo" || !process.env.NEXT_PUBLIC_SUPABASE_URL)
      return;
    const client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    const channel = client
      .channel(`venue-${initial.venue.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "offer_instances",
          filter: `venue_id=eq.${initial.venue.id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "table_sessions",
          filter: `venue_id=eq.${initial.venue.id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_availability",
          filter: `venue_id=eq.${initial.venue.id}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [initial.mode, initial.venue.id, refresh]);
  useEffect(() => setMobile(false), [path]);
  const active = data.instances.filter(
    (i) => i.status === "active" && new Date(i.expiresAt).getTime() > now,
  ).length;
  return (
    <Context.Provider value={{ data, now, refresh, mutate, busy, notify }}>
      <div className="workspace">
        {mobile && (
          <button
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          />
        )}
        <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
          <Link href="/" className="brand-link">
            <Logo light />
          </Link>
          <div className="sidebar-label">WORKSPACE</div>
          <nav>
            {nav
              .filter(
                (n) =>
                  data.role !== "staff" ||
                  ["/", "/tables", "/activity"].includes(n.href),
              )
              .map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`nav-item ${path === n.href ? "selected" : ""}`}
                >
                  <n.icon size={19} />
                  <span>{n.label}</span>
                  {n.href === "/offers" && active > 0 && (
                    <span className="nav-count">{active}</span>
                  )}
                </Link>
              ))}
          </nav>
          <div className="sidebar-label tools-label">TOOLS</div>
          <Link
            href="/simulator"
            className={`nav-item ${path === "/simulator" ? "selected" : ""}`}
          >
            <FlaskConical size={19} />
            <span>POS simulator</span>
            <span className="tiny-tag">DEMO</span>
          </Link>
          {data.role !== "staff" && (
            <Link
              href="/settings"
              className={`nav-item ${path === "/settings" ? "selected" : ""}`}
            >
              <Settings size={19} />
              <span>Venue settings</span>
            </Link>
          )}
          <div className="sidebar-bottom">
            <div className="guardrail-note">
              <ShieldCheck size={20} />
              <strong>Good for your margins.</strong>
              <p>
                Every reward earns its place.
                <br />
                One table. One opportunity.
              </p>
              <Link href="/settings">
                View your guardrails <ArrowUpRight size={15} />
              </Link>
            </div>
            <div className="sidebar-venue">
              <span className="venue-monogram">SS</span>
              <div>
                <strong>The Sunday Social</strong>
                <span>Boat Quay · Singapore</span>
              </div>
              <ChevronDown size={16} />
            </div>
            <div className="sidebar-foot">
              <span>TABLEPULSE V1.0</span>
              <span>Made for hospitality</span>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="topbar-left">
              <button
                className="icon-button mobile-menu"
                onClick={() => setMobile(!mobile)}
                aria-label="Open navigation"
              >
                <Menu size={20} />
              </button>
              <span className="breadcrumb">Workspace</span>
              <span className="breadcrumb-divider">/</span>
              <span className="breadcrumb-current">
                {nav.find((n) => n.href === path)?.label ??
                  (path === "/simulator" ? "POS simulator" : "Venue settings")}
              </span>
            </div>
            <div className="topbar-right">
              <span className="connection-pill">
                <Radio size={13} />
                {data.mode === "demo" ? "Demo workspace" : "Live workspace"}
              </span>
              <span className="topbar-separator" />
              <div className="popover-parent">
                <button
                  className="icon-button"
                  aria-label="Notifications"
                  onClick={() => setNotifications(!notifications)}
                >
                  <Bell size={19} />
                  {data.audits.some(
                    (a) => a.action === "Redemption rejected",
                  ) && <span className="notification-dot" />}
                </button>
                {notifications && (
                  <div className="popover">
                    <strong>Service updates</strong>
                    {data.audits
                      .slice(-4)
                      .reverse()
                      .map((a) => (
                        <p key={a.id}>
                          <b>{a.action}</b>
                          <span>{a.detail}</span>
                        </p>
                      ))}
                    {!data.audits.length && <p>No service updates yet.</p>}
                  </div>
                )}
              </div>
              <div className="popover-parent">
                <button
                  className="profile-button"
                  onClick={() => setRoles(!roles)}
                  aria-label="Account and role"
                >
                  <span className="avatar">JL</span>
                  <span className="profile-text">
                    <b>{data.mode === "demo" ? "Jamie Lee" : "Venue team"}</b>
                    <small>
                      {data.role === "platform_admin"
                        ? "Platform admin"
                        : data.role === "manager"
                          ? "Venue manager"
                          : "Venue staff"}
                    </small>
                  </span>
                  <ChevronDown size={14} />
                </button>
                {roles && (
                  <div className="popover account-popover">
                    <strong>
                      {data.mode === "demo" ? "Try a demo role" : "Account"}
                    </strong>
                    {data.mode === "demo" ? (
                      (["manager", "staff", "platform_admin"] as const).map(
                        (role) => (
                          <button
                            key={role}
                            onClick={async () => {
                              try {
                                await mutate({ role }, "/api/demo/role");
                                setRoles(false);
                                window.location.href =
                                  role === "staff" ? "/tables" : "/";
                              } catch {}
                            }}
                          >
                            {role.replaceAll("_", " ")}
                            {data.role === role && <Check size={16} />}
                          </button>
                        ),
                      )
                    ) : (
                      <button
                        onClick={async () => {
                          await fetch("/api/auth", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "logout" }),
                          });
                          window.location.href = "/login";
                        }}
                      >
                        <LogOut size={16} /> Sign out
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>
          <main className="main-content">{children}</main>
          <footer className="app-footer">
            <span>
              <ShieldCheck size={13} /> Designed for incremental profit. Built
              for responsible hospitality.
            </span>
            <span>
              {data.mode === "demo" ? "Seeded demo data" : "Supabase connected"}{" "}
              <span className="footer-dot">·</span> All amounts in SGD
            </span>
          </footer>
        </div>
        {toast && (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <Activity size={24} />
      <p>{children}</p>
    </div>
  );
}
