"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "./cn";

export interface SubNavItem {
  href: string;
  label: string;
  /** Optional count shown as a small pill ("Open 3"). */
  count?: number;
  /**
   * How the item is matched against the current URL:
   * "exact" (default) — pathname equals href's path;
   * "prefix" — pathname starts with href's path (for sections with child pages);
   * "query" — pathname AND every query param in href must match (tabs like ?tab=lift).
   */
  match?: "exact" | "prefix" | "query";
}

/**
 * Tabs that are plain links, so every tab has its own URL (shareable, back-button safe).
 * Use for sub-sections of a page: Settings (Profile · Programs · Guardrails…), Reports tabs.
 * Reads the URL on the client (usePathname/useSearchParams), so use it on dynamic pages —
 * every authenticated console/staff page is.
 */
export function SubNav({ items, className, label = "Section navigation" }: { items: SubNavItem[]; className?: string; label?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function isActive(item: SubNavItem) {
    const url = new URL(item.href, "http://local");
    const match = item.match ?? (url.search ? "query" : "exact");
    if (match === "prefix") return pathname === url.pathname || pathname.startsWith(`${url.pathname}/`);
    if (pathname !== url.pathname) return false;
    if (match === "query") {
      for (const [key, value] of url.searchParams) if (searchParams.get(key) !== value) return false;
    }
    return true;
  }

  // Tabs that name query params are more specific: "/reports?tab=lift" beats "/reports"
  // when both match. With no ?tab in the URL, the plain "/reports" tab is the active one.
  const withQuery = items.findIndex((item) => item.href.includes("?") && isActive(item));
  const activeIndex = withQuery >= 0 ? withQuery : items.findIndex((item) => !item.href.includes("?") && isActive(item));

  return (
    <nav aria-label={label} className={cn("-mx-4 mb-6 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0", className)}>
      <ul className="flex min-w-max gap-1">
        {items.map((item, index) => {
          const active = index === activeIndex;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "border-accent text-accent-ink" : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {item.label}
                {item.count !== undefined && (
                  <span className={cn("numeric rounded-full px-1.5 text-xs", active ? "bg-accent-soft text-accent-ink" : "bg-surface-sunken text-ink-muted")}>{item.count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
