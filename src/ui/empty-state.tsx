import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** Defaults to an inbox icon. Pass `null` for none. */
  icon?: ReactNode;
  /** Call to action, e.g. a LinkButton. */
  action?: ReactNode;
  /** Less vertical padding (inside tables and small cards). */
  compact?: boolean;
  className?: string;
}

/** Explain why a list is empty and what to do next — never a blank box. */
export function EmptyState({ title, description, icon = <Inbox aria-hidden />, action, compact = false, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 text-center", compact ? "py-8" : "py-14", className)}>
      {icon && <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-sunken text-ink-subtle [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <div className="mt-1 max-w-md text-sm text-ink-muted">{description}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
