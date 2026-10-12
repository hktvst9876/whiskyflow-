import type { ReactNode } from "react";
import { cn } from "./cn";

export interface SectionProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
}

/** A titled block of a page (h2). Sections stack with consistent spacing. */
export function Section({ title, description, actions, id, className, children }: SectionProps) {
  return (
    <section id={id} className={cn("mt-8 first:mt-0", className)} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && (
              <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold text-ink">
                {title}
              </h2>
            )}
            {description && <div className="mt-0.5 text-sm text-ink-muted">{description}</div>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Stack children vertically with standard gaps (default 16px). */
export function Stack({ gap = "md", className, children }: { gap?: "sm" | "md" | "lg"; className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col", gap === "sm" ? "gap-2" : gap === "lg" ? "gap-6" : "gap-4", className)}>{children}</div>;
}
