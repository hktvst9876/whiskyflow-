import type { ReactNode } from "react";
import { cn } from "./cn";

type CardPadding = "none" | "sm" | "md" | "lg";
type CardTone = "default" | "muted" | "accent" | "warning" | "danger";

const paddings: Record<CardPadding, string> = { none: "", sm: "p-4", md: "p-5", lg: "p-6 sm:p-8" };
const tones: Record<CardTone, string> = {
  default: "bg-surface border-line",
  muted: "bg-surface-muted border-line",
  accent: "bg-accent-soft border-accent-line",
  warning: "bg-warning-soft border-warning-line",
  danger: "bg-danger-soft border-danger-line",
};

export interface CardProps {
  /** Optional header. With a title the body is padded below it and `footer` gets its own row. */
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned header content (buttons, a badge). */
  actions?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  /** Body padding. Use "none" for edge-to-edge content (tables) or with CardHeader/CardBody. */
  padding?: CardPadding;
  tone?: CardTone;
  as?: "div" | "section" | "article" | "li";
  className?: string;
  bodyClassName?: string;
  id?: string;
  children?: ReactNode;
}

/**
 * The basic surface. Simple use: `<Card title="Upcoming expiry" actions={…}>…</Card>`.
 * For custom layouts use `padding="none"` and compose CardHeader / CardBody / CardFooter.
 */
export function Card({ title, description, actions, icon, footer, padding = "md", tone = "default", as: Tag = "div", className, bodyClassName, id, children }: CardProps) {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <Tag id={id} className={cn("min-w-0 overflow-hidden rounded-xl border shadow-card", tones[tone], className)}>
      {hasHeader && <CardHeader title={title} description={description} actions={actions} icon={icon} />}
      {children !== undefined && children !== null && (
        <div className={cn(paddings[padding], hasHeader && padding !== "none" && "pt-3", bodyClassName)}>{children}</div>
      )}
      {footer && <CardFooter>{footer}</CardFooter>}
    </Tag>
  );
}

export function CardHeader({ title, description, actions, icon, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 shrink-0 text-ink-subtle [&_svg]:size-5">{icon}</span>}
        <div className="min-w-0">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-muted px-5 py-3 text-sm text-ink-muted", className)}>
      {children}
    </div>
  );
}
