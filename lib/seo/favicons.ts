import type { Metadata, Viewport } from "next";

export const brandThemeColor = "#050405";

export const faviconManifest = "/site.webmanifest?v=itrader-a-20261007";

export const faviconIcons: NonNullable<Metadata["icons"]> = {
  icon: [
    { url: "/favicon.ico?v=itrader-a-20261007", sizes: "16x16 32x32 48x48 64x64 128x128 256x256", type: "image/x-icon" },
    { url: "/favicon-32x32.png?v=itrader-a-20261007", sizes: "32x32", type: "image/png" },
    { url: "/favicon.svg?v=itrader-a-20261007", sizes: "any", type: "image/svg+xml" },
  ],
  shortcut: "/favicon.ico?v=itrader-a-20261007",
  apple: { url: "/apple-touch-icon.png?v=itrader-a-20261007", sizes: "180x180", type: "image/png" },
};

export const faviconThemeColor: NonNullable<Viewport["themeColor"]> = brandThemeColor;
