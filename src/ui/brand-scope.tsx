import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const FALLBACK = "#0f766e";

/** Normalise "#abc" / "aabbcc" to "#aabbcc"; anything else falls back to the console accent. */
export function normaliseHex(color: string | null | undefined): string {
  const match = color?.trim().match(HEX);
  if (!match) return FALLBACK;
  const hex = match[1]!;
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  return `#${full.toLowerCase()}`;
}

function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** White or near-black, whichever reads better on `background` (WCAG contrast). */
export function readableTextColor(background: string): "#ffffff" | "#101828" {
  const l = relativeLuminance(normaliseHex(background));
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (0.0116 + 0.05);
  return onWhite >= onDark ? "#ffffff" : "#101828";
}

/**
 * Applies a merchant's brand colour to everything inside (customer claim page and wallet).
 * Children use `bg-brand`, `text-brand`, `border-brand`, `bg-brand-soft`, `border-brand-line`
 * and `text-brand-contrast` (white or dark, picked for contrast).
 */
export function BrandScope({ color, className, children }: { color: string | null | undefined; className?: string; children: ReactNode }) {
  const brand = normaliseHex(color);
  const style = { "--brand": brand, "--brand-contrast": readableTextColor(brand) } as CSSProperties;
  return (
    <div style={style} className={cn(className)}>
      {children}
    </div>
  );
}
