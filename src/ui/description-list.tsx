import type { ReactNode } from "react";
import { cn } from "./cn";

export interface DescriptionItem {
  term: ReactNode;
  detail: ReactNode;
}

/**
 * Term/detail pairs. Used for the wallet's transparency lines (Covers · Paid · Expires ·
 * When · Upgrades · Sharing · Refunds), customer facts and settings summaries.
 * `layout="inline"` puts terms in a narrow left column (from sm up); "stacked" puts each
 * term above its detail.
 */
export function DescriptionList({ items, layout = "inline", className }: { items: DescriptionItem[]; layout?: "inline" | "stacked"; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line text-sm", className)}>
      {items.map((item, i) => (
        <div key={i} className={cn("py-2.5 first:pt-0 last:pb-0", layout === "inline" && "sm:grid sm:grid-cols-[9rem_1fr] sm:gap-4")}>
          <dt className="font-medium text-ink-muted">{item.term}</dt>
          <dd className={cn("min-w-0 text-ink", layout === "inline" ? "mt-0.5 sm:mt-0" : "mt-0.5")}>{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
