import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Redeem codes and other short codes people read aloud or type at the till. The 8-character
 * wallet code ("K7MQ2XPA") is shown in two groups of four ("K7MQ 2XPA") for readability;
 * the underlying text (for copy/paste and screen readers) stays ungrouped.
 */
export function RedeemCode({ code, size = "md", className }: { code: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const groups = code.length === 8 ? [code.slice(0, 4), code.slice(4)] : [code];
  return (
    <span
      aria-label={code.split("").join(" ")}
      className={cn(
        "inline-flex items-center gap-[0.4em] rounded-lg border border-line-strong bg-surface-muted font-mono font-semibold tracking-[0.18em] text-ink uppercase",
        size === "sm" && "px-2 py-0.5 text-sm",
        size === "md" && "px-3 py-1 text-lg",
        size === "lg" && "px-4 py-2 text-2xl sm:text-3xl",
        className,
      )}
    >
      {groups.map((g, i) => (
        <span key={i} aria-hidden>
          {g}
        </span>
      ))}
    </span>
  );
}

/** Keyboard-key style inline code (shortcuts, short identifiers). */
export function Kbd({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-mono text-[11px] font-medium text-ink-muted shadow-card", className)}>
      {children}
    </kbd>
  );
}

/** Inline monospace text for ids, API keys (masked) and technical values. */
export function Code({ className, children }: { className?: string; children: ReactNode }) {
  return <code className={cn("rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[0.85em] text-ink", className)}>{children}</code>;
}
