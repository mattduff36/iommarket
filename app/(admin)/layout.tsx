import { Suspense } from "react";
import { NavigationContent } from "@/components/navigation/navigation-pending";
import { PageSkeleton } from "@/components/navigation/page-skeletons";
import { SiteHeader } from "@/components/layout/site-header";
import { LiveAccountUpdates } from "@/components/account/live-account-updates";
import { AdminArea } from "@/components/admin/admin-area";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col">
    <SiteHeader previewSite={process.env.VERCEL_ENV === "preview"} />
    <LiveAccountUpdates />
    <NavigationContent className="flex flex-1 flex-col" scope="/admin">
      <Suspense fallback={<PageSkeleton kind="table" />}>
        <AdminArea>{children}</AdminArea>
      </Suspense>
    </NavigationContent>
  </div>;
}
