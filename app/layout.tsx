import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import { ToastProvider } from "@/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: brand.productName, template: `%s · ${brand.productName}` },
  description: brand.tagline,
  applicationName: brand.productName,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: brand.accentColor,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
