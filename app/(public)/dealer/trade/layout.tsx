import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "iTrader",
  robots: { index: false, follow: false },
};

export default function TradeExchangeLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>;
}
