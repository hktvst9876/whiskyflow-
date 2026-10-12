import type { ReactNode } from "react";
import { cn, toneSolid, type Tone } from "./cn";

export interface ProgressProps {
  /** 0–100. Values outside are clamped. */
  value: number;
  /** Visible label above the bar ("Macallan 12", "Preparing demo data…"). */
  label?: ReactNode;
  /** Right-aligned text above the bar (defaults to the percentage when a label is given). */
  valueText?: ReactNode;
  tone?: Tone;
  size?: "sm" | "md";
  /** Accessible name when no visible label is shown. */
  ariaLabel?: string;
  className?: string;
}

/**
 * A horizontal meter: bottle levels ("42% remaining"), units used of a package, seeding
 * progress. Uses role="progressbar" with the numeric value for assistive tech.
 */
export function Progress({ value, label, valueText, tone = "accent", size = "md", ariaLabel, className }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn("min-w-0", className)}>
      {(label || valueText !== undefined) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
          {label && <span className="min-w-0 truncate font-medium text-ink">{label}</span>}
          <span className="numeric shrink-0 text-ink-muted">{valueText ?? `${pct}%`}</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={typeof label === "string" ? label : ariaLabel}
        className={cn("w-full overflow-hidden rounded-full bg-surface-sunken", size === "sm" ? "h-1.5" : "h-2.5")}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-500", toneSolid[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
