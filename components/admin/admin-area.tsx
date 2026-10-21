import { NavigationContent } from "@/components/navigation/navigation-pending";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { AdminNavLink } from "@/components/admin/admin-nav-link";
import { AdminSidebarScroll } from "@/components/admin/admin-sidebar-scroll";
import { ADMIN_NAV, ADMIN_NAV_GROUPS } from "@/lib/admin/nav";
import { isAdminChecklistEnabled } from "@/lib/admin/checklist-feature";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";

export async function AdminArea({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/");
  const checklistEnabled = isAdminChecklistEnabled();
  const stagingFeaturesEnabled = isStagingOnlyFeatureEnabled();
  const navigation = ADMIN_NAV.filter((item) =>
    (item.icon !== "checklist" || checklistEnabled) &&
    (item.icon !== "preview-packs" || stagingFeaturesEnabled) &&
    (item.href !== "/admin/database" || stagingFeaturesEnabled) &&
    (item.href !== "/admin/trade" || isTradeExchangeEnabled()),
  );

  return (
    <div className="admin-area-shell flex min-w-0 flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-64 shrink-0 border-r border-border bg-surface">
          <AdminSidebarScroll>
            {ADMIN_NAV_GROUPS.map((group) => {
              const items = navigation.filter((i) => i.group === group.key);
              if (items.length === 0) return null;
              return (
                <div key={group.key}>
                  <p className={`mb-2 text-xs font-semibold uppercase tracking-wider ${group.accent}`}>
                    {group.label}
                  </p>
                  <nav className="flex flex-col gap-0.5" aria-label={group.label}>
                    {items.map((item) => (
                      <AdminNavLink
                        key={item.href}
                        item={item}
                        accentClass={group.accent}
                      />
                    ))}
                  </nav>
                </div>
              );
            })}
          </AdminSidebarScroll>
        </aside>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 bg-canvas">
          <AdminMobileNav items={navigation} />
          <main className="flex-1">
            <NavigationContent className="p-4 sm:p-6 lg:p-8">{children}</NavigationContent>
          </main>
        </div>
    </div>
  );
}
