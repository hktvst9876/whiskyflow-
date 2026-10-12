import Link from "next/link";
import {
  BarChart3,
  CircleDollarSign,
  Gift,
  LayoutDashboard,
  LogOut,
  Settings,
  ShoppingBasket,
  Users,
} from "lucide-react";
import { logoutAction, switchMerchantAction } from "../actions";
import { requireAuth } from "@/modules/auth/session";

const NAV = [
  { href: "/dashboard", label: "Today", icon: LayoutDashboard },
  { href: "/pos", label: "Till", icon: ShoppingBasket },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/offers", label: "Return Anchors", icon: Gift },
  { href: "/campaigns", label: "Campaigns", icon: CircleDollarSign },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Controls", icon: Settings },
] as const;

export default async function ConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await requireAuth("staff");
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="border-b border-line bg-ink text-white lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
        <div className="flex h-16 items-center justify-between px-5 lg:h-auto lg:block lg:px-5 lg:pt-6 lg:pb-5">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-semibold tracking-tight text-white"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm font-bold">
              RA
            </span>
            <span>Return Anchor</span>
          </Link>
          <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold tracking-wider text-white/70 uppercase lg:mt-3 lg:inline-flex">
            Demo MVP
          </span>
        </div>

        <nav
          aria-label="Main navigation"
          className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:px-3 lg:pb-0"
        >
          {NAV.map(({ href, label, icon: Icon }) => (
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

        <div className="hidden border-t border-white/10 p-4 lg:absolute lg:right-0 lg:bottom-0 lg:left-0 lg:block">
          <form action={switchMerchantAction} className="space-y-2">
            <label
              htmlFor="merchantId"
              className="text-xs font-medium text-white/55"
            >
              Active business
            </label>
            <select
              id="merchantId"
              name="merchantId"
              defaultValue={auth.merchantId}
              className="h-9 w-full rounded-lg border border-white/15 bg-white/10 px-2 text-sm text-white"
            >
              {auth.memberships.map((m) => (
                <option
                  key={m.merchantId}
                  value={m.merchantId}
                  className="text-ink"
                >
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
        </div>
      </aside>
      <main className="min-w-0">
        <div className="mx-auto w-full max-w-[80rem] px-4 py-6 sm:px-6 sm:py-8 xl:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
