"use client";

import { QRCodeSVG } from "qrcode.react";
import { cn } from "./cn";

export interface QrCodeProps {
  /** What the code encodes: a claim URL, a wallet URL, or a redeem code. */
  value: string;
  /** Rendered size in px (the SVG scales; this sets the box). */
  size?: number;
  /** Accessible description, e.g. "QR code to claim 1 Main Waiting". */
  title: string;
  /** Error correction: "M" is a good default for URLs shown on screens. */
  level?: "L" | "M" | "Q" | "H";
  className?: string;
}

/**
 * QR code as SVG. Always dark-on-white with a quiet zone so phone cameras read it on any
 * background (do not tint it with the merchant colour).
 */
export function QrCode({ value, size = 200, title, level = "M", className }: QrCodeProps) {
  return (
    <div className={cn("inline-flex rounded-xl border border-line bg-white p-2 shadow-card", className)}>
      <QRCodeSVG value={value} size={size} level={level} marginSize={2} title={title} bgColor="#ffffff" fgColor="#101828" role="img" className="block h-auto max-w-full" />
    </div>
  );
}
