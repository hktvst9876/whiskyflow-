"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useTransition, type FormEvent, type FormHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/core/result";
import { Alert } from "./alert";
import { Button, type ButtonProps } from "./button";
import { useToast } from "./toast";

/**
 * Forms wired to server actions that return `ActionResult` (see src/server/action.ts).
 *
 *   <ActionForm action={saveItem} successMessage="Item saved">
 *     <Field label="Name" name="name"><Input name="name" required /></Field>
 *     <SubmitButton>Save</SubmitButton>
 *   </ActionForm>
 *
 * - The form-level error (`result.error`) shows as an Alert; `result.fieldErrors[name]`
 *   shows under the matching <Field name>.
 * - Unlike a bare `<form action>`, the inputs are NOT cleared after submit, so people can
 *   fix a validation error without retyping. Pass `resetOnSuccess` for "add another" forms.
 * - Works before hydration too (progressive enhancement through the form `action`).
 */

/** The signature `useActionState` expects from a server action. */
export type FormAction<T = unknown> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

interface ActionFormState {
  state: ActionResult<unknown> | null;
  pending: boolean;
}

const ActionFormContext = createContext<ActionFormState | null>(null);

/** Read the enclosing ActionForm's latest result and pending flag (null outside one). */
export function useActionFormState(): ActionFormState | null {
  return useContext(ActionFormContext);
}

function messageFrom(data: unknown): string | null {
  if (data && typeof data === "object" && "message" in data && typeof (data as { message: unknown }).message === "string") {
    return (data as { message: string }).message;
  }
  return null;
}

export interface ActionFormProps<T> extends Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "onSubmit" | "children"> {
  action: FormAction<T>;
  children: ReactNode;
  /** Toast shown on success. If omitted, a `message` string in the result data is used. */
  successMessage?: string;
  /** Clear the inputs after a successful submit. */
  resetOnSuccess?: boolean;
  /** Where the form-level error appears. */
  errorPlacement?: "top" | "bottom" | "none";
  /** Client-side callback after success (only from client components). */
  onSuccess?: (data: T) => void;
}

export function ActionForm<T>({ action, children, successMessage, resetOnSuccess = false, errorPlacement = "top", onSuccess, ...formProps }: ActionFormProps<T>) {
  const [state, dispatch, pending] = useActionState<ActionResult<T> | null, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionResult<T> | null>(null);
  const toast = useToast();
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (!state.ok) return;
    const message = successMessage ?? messageFrom(state.data);
    if (message) toast.success(message);
    if (resetOnSuccess) formRef.current?.reset();
    onSuccessRef.current?.(state.data);
  }, [state, successMessage, resetOnSuccess, toast]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Dispatching ourselves (instead of letting React run `action`) keeps the inputs'
    // values after the submit; React only auto-resets forms whose action it ran.
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(data));
  }

  return (
    <ActionFormContext.Provider value={{ state, pending }}>
      <form ref={formRef} action={dispatch} onSubmit={handleSubmit} {...formProps}>
        {errorPlacement === "top" && <FormError className="mb-4" />}
        {children}
        {errorPlacement === "bottom" && <FormError className="mt-4" />}
      </form>
    </ActionFormContext.Provider>
  );
}

/** The latest form-level error of the enclosing ActionForm (renders nothing when fine). */
export function FormError({ className }: { className?: string }) {
  const ctx = useActionFormState();
  if (!ctx?.state || ctx.state.ok) return null;
  return (
    <Alert tone="danger" className={className}>
      {ctx.state.error}
    </Alert>
  );
}

/**
 * Error text for one field: the explicit `error` prop, else the enclosing ActionForm's
 * `fieldErrors[name]`. Rendered by <Field>; use directly only for custom layouts.
 */
export function FieldError({ name, error, id }: { name?: string; error?: string | null; id?: string }) {
  const ctx = useActionFormState();
  const fromAction = name && ctx?.state && !ctx.state.ok ? ctx.state.fieldErrors?.[name] : undefined;
  const message = error ?? fromAction;
  if (!message) return null;
  return (
    <p id={id} data-field-error="" className="mt-1.5 text-sm text-danger" role="alert">
      {message}
    </p>
  );
}

export interface SubmitButtonProps extends Omit<ButtonProps, "type" | "loading"> {
  /** Label while the action runs, e.g. "Saving…". Defaults to the normal label. */
  pendingLabel?: ReactNode;
}

/** Submit button that disables itself and shows a spinner while the form's action runs. */
export function SubmitButton({ pendingLabel, children, disabled, ...props }: SubmitButtonProps) {
  const ctx = useActionFormState();
  const status = useFormStatus();
  const pending = ctx?.pending || status.pending;
  return (
    <Button type="submit" loading={pending} disabled={disabled} {...props}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

export interface ActionButtonProps<T> extends Omit<ButtonProps, "onClick" | "type" | "loading"> {
  /**
   * A server action taking no arguments — bind ids on the server:
   * `action={voidAnchor.bind(null, entitlementId)}`.
   */
  action: () => Promise<ActionResult<T>>;
  /** Ask before running (native confirm dialog), e.g. "Void this anchor?". */
  confirm?: string;
  successMessage?: string;
  onSuccess?: (data: T) => void;
}

/** A one-click action button (no form fields). Errors show as a toast. */
export function ActionButton<T>({ action, confirm, successMessage, onSuccess, children, disabled, ...props }: ActionButtonProps<T>) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Button
      {...props}
      loading={pending}
      disabled={disabled}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const result = await action();
          if (result.ok) {
            const message = successMessage ?? messageFrom(result.data);
            if (message) toast.success(message);
            onSuccess?.(result.data);
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      {children}
    </Button>
  );
}
