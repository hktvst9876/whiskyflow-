/**
 * Join class names, skipping falsy values. Deliberately tiny (no tailwind-merge): a
 * `className` passed to a primitive is appended, so use the primitive's props (variant,
 * size, padding…) for anything the base classes already set.
 */
export type ClassValue = string | false | null | undefined | 0;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

/** The six semantic tones shared by badges, alerts, stats and progress bars. */
export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

/** Soft background + readable text + border, per tone (literal strings so Tailwind sees them). */
export const toneSoft: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-neutral-ink border-neutral-line",
  success: "bg-success-soft text-success-ink border-success-line",
  warning: "bg-warning-soft text-warning-ink border-warning-line",
  danger: "bg-danger-soft text-danger-ink border-danger-line",
  info: "bg-info-soft text-info-ink border-info-line",
  accent: "bg-accent-soft text-accent-ink border-accent-line",
};

/** Solid fill per tone (dots, bars). */
export const toneSolid: Record<Tone, string> = {
  neutral: "bg-ink-subtle",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  accent: "bg-accent",
};

/** Text colour per tone for values on a white surface. */
export const toneText: Record<Tone, string> = {
  neutral: "text-ink",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  accent: "text-accent",
};
