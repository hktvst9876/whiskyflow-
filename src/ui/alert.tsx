import { CircleAlert, CircleCheck, Info, Lightbulb, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn, toneSoft, type Tone } from "./cn";

const icons: Record<Tone, ReactNode> = {
  neutral: <Info aria-hidden />,
  info: <Info aria-hidden />,
  accent: <Lightbulb aria-hidden />,
  success: <CircleCheck aria-hidden />,
  warning: <TriangleAlert aria-hidden />,
  danger: <CircleAlert aria-hidden />,
};

export interface AlertProps {
  tone?: Tone;
  title?: ReactNode;
  /** Override the tone's icon; pass `null` for none. */
  icon?: ReactNode;
  /** Buttons/links shown under the text. */
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/**
 * Inline message box. Danger/warning alerts are announced to screen readers (role="alert");
 * the others are polite status messages.
 */
export function Alert({ tone = "info", title, icon, actions, className, children }: AlertProps) {
  const role = tone === "danger" || tone === "warning" ? "alert" : "status";
  return (
    <div role={role} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", toneSoft[tone], className)}>
      {icon !== null && <span className="mt-px shrink-0 [&_svg]:size-[18px]">{icon ?? icons[tone]}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "[&_a]:font-medium [&_a]:underline")}>{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * A softer explanatory block for "why" text in the console (how a number is computed,
 * what a guardrail does). Same API as Alert; defaults to the accent tone.
 */
export function Callout({ tone = "accent", ...props }: AlertProps) {
  return <Alert tone={tone} {...props} />;
}
