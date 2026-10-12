import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
/** `touch` is the large size for staff tablets and phones (56px tall, 18px text). */
export type ButtonSize = "sm" | "md" | "lg" | "touch";

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors select-none " +
  "disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-ink-inverse shadow-card hover:bg-accent-hover active:bg-accent-active",
  secondary: "border border-line-strong bg-surface text-ink shadow-card hover:bg-surface-muted active:bg-surface-sunken",
  ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink active:bg-line",
  danger: "bg-danger text-ink-inverse shadow-card hover:bg-danger-hover focus-visible:outline-danger",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm [&_svg]:size-4",
  md: "h-10 px-4 text-sm [&_svg]:size-4",
  lg: "h-12 px-5 text-base [&_svg]:size-5",
  touch: "h-14 min-w-14 px-6 text-lg [&_svg]:size-6 rounded-xl",
};

export interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

/** Class string for anything that should look like a button (e.g. a <summary>). */
export function buttonClasses({ variant = "primary", size = "md", fullWidth = false }: ButtonStyleProps = {}, className?: string) {
  return cn(base, variants[variant], sizes[size], fullWidth && "w-full", className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {
  /** Icon element shown before the label, e.g. `icon={<Plus />}`. */
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
}

export function Button({ variant, size, fullWidth, icon, iconRight, loading = false, className, children, type = "button", disabled, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, fullWidth }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

export interface LinkButtonProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">, ButtonStyleProps {
  href: string;
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Pass false for links that must not prefetch (e.g. heavy reports). */
  prefetch?: boolean;
}

/** A Next.js <Link> styled as a button. Use for navigation; use <Button> for actions. */
export function LinkButton({ href, variant, size, fullWidth, icon, iconRight, className, children, prefetch, ...props }: LinkButtonProps) {
  return (
    <Link href={href} prefetch={prefetch} className={buttonClasses({ variant, size, fullWidth }, className)} {...props}>
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}

/** Small inline spinner for pending states outside buttons. */
export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <LoaderCircle className={cn("size-4 animate-spin text-ink-subtle", className)} role="status" aria-label={label} />;
}
