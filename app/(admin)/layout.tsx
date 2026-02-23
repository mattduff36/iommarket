import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { ADMIN_NAV, ADMIN_NAV_GROUPS } from "@/lib/admin/nav";
import { ArrowLeft } from "lucide-react";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/");

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-border bg-surface">
        <div className="flex h-16 items-center border-b border-border px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to site
          </Link>
        </div>
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
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors"
                    >
                      <item.icon className={`h-4 w-4 ${group.accent} opacity-50 group-hover:opacity-100 transition-opacity`} />
                      {item.label}
                    </Link>
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
  );
}
