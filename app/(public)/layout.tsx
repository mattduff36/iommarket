import { NavigationContent } from "@/components/navigation/navigation-pending";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { CookieBanner } from "@/components/layout/cookie-banner";
import { LiveAccountUpdates } from "@/components/account/live-account-updates";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader previewSite={process.env.VERCEL_ENV === "preview"} />
      <LiveAccountUpdates />
      <main className="flex-1"><NavigationContent scope={["/account", "/dealer"]}>{children}</NavigationContent></main>
      <SiteFooter />
      <CookieBanner />
    </div>
  );
}
