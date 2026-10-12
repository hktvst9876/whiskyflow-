import Link from "next/link";
import type { ReactNode } from "react";
import { cn, toneText, type Tone } from "./cn";

export interface StatProps {
  label: ReactNode;
  /** The figure itself, already formatted (use <Money> for cents). */
  value: ReactNode;
  /** Context under the value: "12 customers", "+$140 vs last week". */
  sublabel?: ReactNode;
  /** Colours the value. Keep "neutral" unless the colour carries meaning (good/bad). */
  tone?: Tone;
  icon?: ReactNode;
  /** Shown next to the label, e.g. <MetricNote kind="attributed" />. */
  note?: ReactNode;
  /** Makes the whole tile a link to the detail view. */
  href?: string;
  size?: "md" | "lg";
  className?: string;
}

/** One KPI tile. Pair any money figure with its contribution or cost, never a raw count alone. */
export function Stat({ label, value, sublabel, tone = "neutral", icon, note, href, size = "md", className }: StatProps) {
  const body = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-medium text-ink-muted">{label}</div>
        {icon && <span className="shrink-0 text-ink-subtle [&_svg]:size-4">{icon}</span>}
      </div>
      <div className={cn("numeric mt-1.5 font-semibold tracking-tight", size === "lg" ? "text-3xl" : "text-2xl", toneText[tone])}>{value}</div>
      {sublabel && <div className="mt-1 text-sm text-ink-subtle">{sublabel}</div>}
      {note && <div className="mt-2">{note}</div>}
    </>
  );
  const classes = cn("relative flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5", href && "transition-colors hover:border-line-strong hover:bg-surface-muted", className);
  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}

const gridColumns = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
} as const;

/** Responsive grid of <Stat> tiles: one column on phones, up to `columns` on wide screens. */
export function StatGrid({ columns = 4, className, children }: { columns?: keyof typeof gridColumns; className?: string; children: ReactNode }) {
  return <div className={cn("grid grid-cols-1 gap-3 sm:gap-4", gridColumns[columns], className)}>{children}</div>;
}
