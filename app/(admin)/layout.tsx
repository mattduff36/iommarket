import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { AdminNavLink } from "@/components/admin/admin-nav-link";
import { SiteHeader } from "@/components/layout/site-header";
import { ADMIN_NAV, ADMIN_NAV_GROUPS } from "@/lib/admin/nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/");

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex min-w-0 flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-64 shrink-0 border-r border-border bg-surface">
          <div className="px-4 py-4 space-y-5 overflow-y-auto max-h-[calc(100vh-4rem)]">
            {ADMIN_NAV_GROUPS.map((group) => {
              const items = ADMIN_NAV.filter((i) => i.group === group.key);
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
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 bg-canvas">
          <AdminMobileNav />
          <main className="flex-1">
            <div className="p-4 sm:p-6 lg:p-8">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
