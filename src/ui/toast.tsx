"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * Minimal toasts for action feedback ("Saved", "3 reminders sent"). One provider sits in
 * the root layout; `useToast()` works anywhere below it and is a safe no-op outside.
 * Errors that need the user to fix something belong in the form (ActionForm), not here.
 */

export type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const noop: ToastApi = { show: () => {}, success: () => {}, error: () => {}, info: () => {} };
const ToastContext = createContext<ToastApi>(noop);

const DISMISS_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId.current++;
    // Keep at most three on screen; the newest wins.
    setItems((list) => [...list.slice(-2), { id, message, tone }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ show, success: (m) => show(m, "success"), error: (m) => show(m, "error"), info: (m) => show(m, "info") }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {items.map((item) => (
          <Toast key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const toneStyles: Record<ToastTone, { icon: ReactNode; className: string }> = {
  success: { icon: <CircleCheck className="size-5 text-success" aria-hidden />, className: "border-success-line" },
  error: { icon: <CircleAlert className="size-5 text-danger" aria-hidden />, className: "border-danger-line" },
  info: { icon: <Info className="size-5 text-info" aria-hidden />, className: "border-line" },
};

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(item.id), DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [item.id, onDismiss]);
  const style = toneStyles[item.tone];
  return (
    <div
      role={item.tone === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border bg-surface px-4 py-3 text-sm text-ink shadow-pop",
        style.className,
      )}
    >
      <span className="mt-px shrink-0">{style.icon}</span>
      <p className="min-w-0 flex-1">{item.message}</p>
      <button type="button" onClick={() => onDismiss(item.id)} className="-m-1 shrink-0 rounded-md p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink" aria-label="Dismiss">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
