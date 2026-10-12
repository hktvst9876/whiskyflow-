"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";

/** Copies `value` to the clipboard (claim links, wallet links, API keys shown once). */
export function CopyButton({ value, label = "Copy", copiedLabel = "Copied", variant = "secondary", size = "sm", className }: { value: string; label?: string; copiedLabel?: string; variant?: ButtonVariant; size?: ButtonSize; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      icon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard can be blocked (http, permissions); the value is visible to copy by hand.
        }
      }}
    >
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </Button>
  );
}
