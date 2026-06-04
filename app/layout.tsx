import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeLog — Day Trading Dashboard",
  description: "Track trades, P&L, and lessons learned",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
