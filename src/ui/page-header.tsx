import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right (wrap below the title on phones). */
  actions?: ReactNode;
  /** Small line above the title, e.g. the merchant name or a section. */
  eyebrow?: ReactNode;
  /** Back link shown above the title (detail pages). */
  back?: { href: string; label: string };
  /** Badges or meta under the description. */
  meta?: ReactNode;
  className?: string;
}

/** The first thing on every console page: one h1, a plain-words description, the primary actions. */
export function PageHeader({ title, description, actions, eyebrow, back, meta, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        )}
        {eyebrow && <div className="mb-1 text-xs font-semibold tracking-wide text-accent uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
        {description && <div className="mt-1.5 max-w-3xl text-sm text-ink-muted sm:text-base">{description}</div>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
