import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "TablePulse · The profitable little extra",
  description: "Personalised table rewards, built around incremental profit.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
