import type { Metadata } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import { ClerkProviderWrapper } from "@/components/providers/clerk-provider";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const dmSerifDisplay = DM_Serif_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "itrader.im - Isle of Man Marketplace",
    template: "%s | itrader.im",
  },
  description:
    "The trusted hyper-local marketplace for the Isle of Man. Buy and sell vehicles, marine, hi-fi, instruments, and more.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ),
  openGraph: {
    type: "website",
    locale: "en_GB",
    siteName: "itrader.im",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProviderWrapper>
      <html lang="en" className={`${dmSans.variable} ${dmSerifDisplay.variable}`}>
        <body className="min-h-screen antialiased bg-canvas text-text-primary">
          {children}
        </body>
      </html>
    </ClerkProviderWrapper>
  );
}
