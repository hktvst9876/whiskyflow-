import { FlaskConical, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn, toneSoft, toneSolid, type Tone } from "./cn";

export interface BadgeProps {
  tone?: Tone;
  size?: "sm" | "md";
  /** Small coloured dot before the label (status indicators). */
  dot?: boolean;
  icon?: ReactNode;
  className?: string;
  title?: string;
  children: ReactNode;
}

function badgeClasses(tone: Tone, size: "sm" | "md", shape: string, className?: string) {
  return cn(
    "inline-flex max-w-full items-center gap-1.5 border font-medium whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0",
    size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
    shape,
    toneSoft[tone],
    className,
  );
}

/** Compact status label: segment, role, entitlement status, "Demo data". */
export function Badge({ tone = "neutral", size = "md", dot = false, icon, className, title, children }: BadgeProps) {
  return (
    <span className={badgeClasses(tone, size, "rounded-md", className)} title={title}>
      {dot && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", toneSolid[tone])} />}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Same as Badge with a fully rounded shape — for counts, filters and tags. */
export function Pill({ tone = "neutral", size = "md", dot = false, icon, className, title, children }: BadgeProps) {
  return (
    <span className={badgeClasses(tone, size, "rounded-full", className)} title={title}>
      {dot && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", toneSolid[tone])} />}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * Required honesty labels for money metrics (brief §11, §19). Attribution counts all new
 * spend on redemption visits — including spend that would have happened anyway — so it is
 * never presented as causal. Only the randomised holdout answers "did this make money?".
 */
export const ATTRIBUTED_LABEL = "Attributed, not causal";
export const MEASURED_LIFT_LABEL = "Measured lift (randomised holdout)";
export const ESTIMATE_LABEL = "Estimate";

const METRIC_NOTES = {
  attributed: { label: ATTRIBUTED_LABEL, tone: "info", icon: <Info aria-hidden />, title: "Counts every sale on redemption visits, including spend that may have happened anyway." },
  measured: { label: MEASURED_LIFT_LABEL, tone: "accent", icon: <FlaskConical aria-hidden />, title: "Treatment vs a randomly held-out control group: the causal answer." },
  estimate: { label: ESTIMATE_LABEL, tone: "neutral", icon: <Info aria-hidden />, title: "A model expectation before the fact, not a measured result." },
} as const satisfies Record<string, { label: string; tone: Tone; icon: ReactNode; title: string }>;

export type MetricNoteKind = keyof typeof METRIC_NOTES;

/** `<MetricNote kind="attributed" />` next to any attributed money figure; `kind="measured"` on the lift card. */
export function MetricNote({ kind, size = "sm", className }: { kind: MetricNoteKind; size?: "sm" | "md"; className?: string }) {
  const note = METRIC_NOTES[kind];
  return (
    <Badge tone={note.tone} size={size} icon={note.icon} title={note.title} className={className}>
      {note.label}
    </Badge>
  );
}
