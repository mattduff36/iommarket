import type { Metadata, Viewport } from "next";

export const brandThemeColor = "#050405";

export const faviconManifest = "/site.webmanifest";

export const faviconIcons: NonNullable<Metadata["icons"]> = {
  icon: [
    { url: "/favicon.svg", type: "image/svg+xml" },
    { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
  ],
  shortcut: "/favicon.ico",
  apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
};

export const faviconThemeColor: NonNullable<Viewport["themeColor"]> = brandThemeColor;
