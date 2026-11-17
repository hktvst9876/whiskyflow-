import Link from "next/link";
import {
  BarChart3,
  CircleDollarSign,
  FastForward,
  Gift,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Play,
  Settings,
  ShoppingBasket,
  Users,
} from "lucide-react";
import { logoutAction, switchMerchantAction } from "../actions";
import { advanceDemoClockAction, runSchedulerNowAction } from "./demo-actions";
import { env } from "@/config/env";
import { formatDate } from "@/core/time";
import { hasRole, type Role } from "@/modules/merchants/types";
import { requireAuth } from "@/modules/auth/session";
import { getNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { ActionButton } from "@/ui/action-form";

/** Till staff sell and redeem; everything about money and rules needs a manager. */
const NAV: { href: string; label: string; icon: typeof Gift; minRole: Role }[] = [
  { href: "/dashboard", label: "Today", icon: LayoutDashboard, minRole: "manager" },
  { href: "/pos", label: "Till", icon: ShoppingBasket, minRole: "staff" },
  { href: "/customers", label: "Customers", icon: Users, minRole: "manager" },
  { href: "/offers", label: "Return Anchors", icon: Gift, minRole: "manager" },
  { href: "/campaigns", label: "Campaigns", icon: CircleDollarSign, minRole: "manager" },
  { href: "/messages", label: "Messages", icon: MessageCircle, minRole: "manager" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, minRole: "manager" },
  { href: "/settings", label: "Controls", icon: Settings, minRole: "manager" },
];

export default async function ConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await requireAuth("staff");
  const nav = NAV.filter((item) => hasRole(auth.role, item.minRole));
  const demo = env().demoMode;
  const now = demo ? await getNow(await getDb()) : null;
  const account = (
    <>
      <form action={switchMerchantAction} className="space-y-2">
        <label htmlFor="merchantId" className="text-xs font-medium text-white/55">
          Active business
        </label>
        <select
          id="merchantId"
          name="merchantId"
          defaultValue={auth.merchantId}
          className="h-9 w-full rounded-lg border border-white/15 bg-white/10 px-2 text-sm text-white"
        >
          {auth.memberships.map((m) => (
            <option key={m.merchantId} value={m.merchantId} className="text-ink">
              {m.merchantName}
            </option>
          ))}
        </select>
        {auth.memberships.length > 1 && (
          <button className="w-full rounded-lg bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/15">
            Switch business
          </button>
        )}
      </form>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/10 pt-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{auth.userName}</p>
          <p className="text-xs text-white/50 capitalize">{auth.role}</p>
        </div>
        <form action={logoutAction}>
          <button
            aria-label="Sign out"
            title="Sign out"
            className="rounded-lg p-2 text-white/55 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </>
  );
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="border-b border-line bg-ink text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex h-16 items-center justify-between px-5 lg:h-auto lg:block lg:px-5 lg:pt-6 lg:pb-5">
          <Link
            href={auth.role === "staff" ? "/pos" : "/dashboard"}
            className="flex items-center gap-2 font-semibold tracking-tight text-white"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm font-bold">
              RA
            </span>
            <span>Return Anchor</span>
          </Link>
          {demo && (
            <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold tracking-wider text-white/70 uppercase lg:mt-3 lg:inline-flex">
              Demo data
            </span>
          )}
        </div>

        <nav
          aria-label="Main navigation"
          className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:overflow-y-auto lg:px-3 lg:pb-0"
        >
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/72 transition hover:bg-white/10 hover:text-white"
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>

        {/* Phones and tablets: the same account controls, folded away under the menu. */}
        <details className="border-t border-white/10 px-4 py-2 lg:hidden">
          <summary className="cursor-pointer py-1 text-xs font-medium text-white/70">
            {auth.merchant.name} · {auth.userName}
          </summary>
          <div className="pt-2 pb-3">{account}</div>
        </details>
        <div className="hidden border-t border-white/10 p-4 lg:mt-auto lg:block">
          {account}
        </div>
      </aside>
      <main className="min-w-0">
        {demo && now && hasRole(auth.role, "manager") && (
          <div className="border-b border-warning-line bg-warning-soft">
            <div className="mx-auto flex w-full max-w-[80rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm text-warning-ink sm:px-6 xl:px-10">
              <p className="mr-auto">
                <strong>Demo.</strong> Simulated customers and a simulated clock:{" "}
                <strong>
                  {formatDate(now, {
                    timeZone: auth.merchant.timezone,
                    locale: auth.merchant.locale,
                    withTime: true,
                  })}
                </strong>
              </p>
              <ActionButton
                action={advanceDemoClockAction.bind(null, 1)}
                variant="secondary"
                size="sm"
                icon={<FastForward />}
              >
                +1 day
              </ActionButton>
              <ActionButton
                action={advanceDemoClockAction.bind(null, 7)}
                variant="secondary"
                size="sm"
                icon={<FastForward />}
              >
                +7 days
              </ActionButton>
              <ActionButton
                action={runSchedulerNowAction}
                variant="secondary"
                size="sm"
                icon={<Play />}
              >
                Run scheduler
              </ActionButton>
            </div>
          </div>
        )}
        <div className="mx-auto w-full max-w-[80rem] px-4 py-6 sm:px-6 sm:py-8 xl:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
