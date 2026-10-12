import { ChevronDown } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { FieldError } from "./action-form";
import { cn } from "./cn";

/*
 * Form controls. All are plain (server-compatible) elements that work inside <ActionForm>
 * and in ordinary forms. Inside an ActionForm, <Field name="x"> shows `fieldErrors.x` from
 * the action result and its control turns red (CSS `:has([data-field-error])`).
 */

const control =
  "block w-full min-w-0 rounded-lg border border-line-strong bg-surface text-ink shadow-card placeholder:text-ink-subtle/80 transition-colors " +
  "hover:border-ink-subtle/60 focus:border-accent focus:outline-2 focus:-outline-offset-1 focus:outline-accent " +
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle " +
  "aria-[invalid=true]:border-danger group-has-[[data-field-error]]/field:border-danger";

const controlSizes = { md: "h-10 px-3 text-sm", lg: "h-12 px-4 text-base", touch: "h-14 px-4 text-lg" } as const;
export type ControlSize = keyof typeof controlSizes;

export interface FieldProps {
  label: ReactNode;
  /** The control's id (defaults to `name`). */
  htmlFor?: string;
  /** Field name used to look up `fieldErrors[name]` from the enclosing ActionForm. */
  name?: string;
  hint?: ReactNode;
  /** Explicit error (wins over the action's field error). */
  error?: string | null;
  required?: boolean;
  /** Shows "Optional" next to the label. */
  optional?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint + error, stacked. */
export function Field({ label, htmlFor, name, hint, error, required, optional, className, children }: FieldProps) {
  const id = htmlFor ?? name;
  return (
    <div className={cn("group/field min-w-0", className)}>
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-ink">
        <span>
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
          )}
        </span>
        {optional && <span className="text-xs font-normal text-ink-subtle">Optional</span>}
      </label>
      {children}
      {hint && (
        <p id={id ? `${id}-hint` : undefined} className="mt-1.5 text-sm text-ink-subtle">
          {hint}
        </p>
      )}
      <FieldError name={name ?? htmlFor} error={error} id={id ? `${id}-error` : undefined} />
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  size?: ControlSize;
  /** Text or icon inside the left edge, e.g. a currency symbol. */
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export function Input({ size = "md", prefix, suffix, className, id, name, ...props }: InputProps) {
  const input = <input id={id ?? name} name={name} className={cn(control, controlSizes[size], prefix ? "pl-9" : "", suffix ? "pr-12" : "", className)} {...props} />;
  if (!prefix && !suffix) return input;
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-subtle [&_svg]:size-4">{prefix}</span>}
      {input}
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-subtle">{suffix}</span>}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: ControlSize;
  /** Convenience: render these instead of children. */
  options?: SelectOption[];
  /** First, empty option (e.g. "Choose…"). */
  placeholder?: string;
}

export function Select({ size = "md", options, placeholder, className, id, name, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select id={id ?? name} name={name} className={cn(control, controlSizes[size], "appearance-none pr-9", className)} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
    </div>
  );
}

export function Textarea({ className, id, name, rows = 4, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea id={id ?? name} name={name} rows={rows} className={cn(control, "px-3 py-2 text-sm", className)} {...props} />;
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  description?: ReactNode;
}

/** Checkbox with its label to the right (and optional description underneath). */
export function Checkbox({ label, description, className, id, name, ...props }: CheckboxProps) {
  const inputId = id ?? (name && props.value !== undefined ? `${name}-${String(props.value)}` : name);
  return (
    <label htmlFor={inputId} className={cn("flex cursor-pointer items-start gap-3 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60", className)}>
      <input
        type="checkbox"
        id={inputId}
        name={name}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-strong accent-accent disabled:cursor-not-allowed"
        {...props}
      />
      <span className="min-w-0">
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

/**
 * An on/off switch. It is a real checkbox (role="switch"), so it submits `name=on` when on
 * and nothing when off — parse with `formData.get(name) === "on"`.
 */
export function Toggle({ label, description, className, id, name, ...props }: CheckboxProps) {
  const inputId = id ?? name;
  return (
    <label htmlFor={inputId} className={cn("flex cursor-pointer items-start justify-between gap-4 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60", className)}>
      <span className="min-w-0">
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-ink-muted">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input type="checkbox" role="switch" id={inputId} name={name} className="peer sr-only" {...props} />
        <span
          aria-hidden
          className={cn(
            "h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-accent",
            "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
            "after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-surface after:shadow-raised after:transition-transform peer-checked:after:translate-x-5",
          )}
        />
      </span>
    </label>
  );
}

/** Lay fields out in a responsive grid (1 column on phones, `columns` from sm up). */
export function FieldGrid({ columns = 2, className, children }: { columns?: 1 | 2 | 3; className?: string; children: ReactNode }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-2 lg:grid-cols-3", className)}>{children}</div>
  );
}
