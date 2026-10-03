import type { Metadata, Viewport } from "next";
import { Inter, Orbitron } from "next/font/google";
import { ThemeProvider } from "@once-ui-system/core";
import { PreviewArrival } from "@/components/launch/preview-arrival";
import { ClientErrorListener } from "@/components/monitoring/client-error-listener";
import { launchWelcomeEnvironment, PUBLIC_LAUNCH_AT } from "@/lib/launch/preview-rehearsal";
import { ConsentedAnalytics } from "@/components/layout/consented-analytics";
import { MarketingMeasurement } from "@/components/advertising/marketing-measurement";
import { publicAdvertisingConfig } from "@/lib/advertising/config";
import { getCanonicalBaseUrl } from "@/lib/seo/structured-data";
import { defaultSocialImage, resolvePageRobots } from "@/lib/seo/page-metadata";
import { faviconIcons, faviconManifest, faviconThemeColor } from "@/lib/seo/favicons";
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
  viewportFit: "cover",
  themeColor: faviconThemeColor,
};

export async function generateMetadata(): Promise<Metadata> {
  const image = defaultSocialImage();
  return {
    title: {
      default: "iTrader.im – Isle of Man Vehicle Sales",
      template: "%s | itrader.im",
    },
    description: "Buy and sell cars, vans, motorbikes, and motorhomes on the Isle of Man.",
    metadataBase: getCanonicalBaseUrl(),
    manifest: faviconManifest,
    icons: faviconIcons,
    robots: resolvePageRobots(true),
    openGraph: {
      type: "website",
      locale: "en_GB",
      siteName: "itrader.im",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      images: [image.url],
    },
  };
}

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
          {process.env.VERCEL_ENV === "preview" ? null : (
            <PreviewArrival
              opensAt={PUBLIC_LAUNCH_AT}
              environment={launchWelcomeEnvironment()}
            />
          )}
          <ClientErrorListener />
          <ConsentedAnalytics />
          <MarketingMeasurement config={publicAdvertisingConfig()} />
        </ThemeProvider>
      </body>
    </html>
  );
}
