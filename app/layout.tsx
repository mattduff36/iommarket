import type { Metadata } from "next";
import { ClerkProviderWrapper } from "@/components/providers/clerk-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "IOM Market - Isle of Man Marketplace",
    template: "%s | IOM Market",
  },
  description:
    "The trusted hyper-local marketplace for the Isle of Man. Buy and sell vehicles, marine, hi-fi, instruments, and more.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ),
  openGraph: {
    type: "website",
    locale: "en_GB",
    siteName: "IOM Market",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProviderWrapper>
      <html lang="en">
        <body className="min-h-screen antialiased bg-canvas text-text-primary">
          {children}
        </body>
      </html>
    </ClerkProviderWrapper>
  );
}
