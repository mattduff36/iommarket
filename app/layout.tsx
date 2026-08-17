import type { Metadata, Viewport } from "next";
import { Inter, Orbitron } from "next/font/google";
import { ThemeProvider } from "@once-ui-system/core";
import { ClientErrorListener } from "@/components/monitoring/client-error-listener";
import { ConsentedAnalytics } from "@/components/layout/consented-analytics";
import { getCanonicalBaseUrl } from "@/lib/seo/structured-data";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "iTrader.im – Isle of Man Vehicle Sales",
    template: "%s | itrader.im",
  },
  description: "Buy and sell cars, vans, motorbikes, and motorhomes on the Isle of Man.",
  metadataBase: getCanonicalBaseUrl(),
  icons: {
    icon: "/images/icon-itrader.png",
    apple: "/images/icon-itrader.png",
    shortcut: "/images/icon-itrader.png",
  },
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
    <html
      lang="en"
      className={`${inter.variable} ${orbitron.variable}`}
      data-theme="dark"
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased bg-canvas text-text-primary">
        <ThemeProvider theme="dark" brand="blue" accent="indigo">
          {children}
          <ClientErrorListener />
          <ConsentedAnalytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
