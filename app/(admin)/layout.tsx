import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import {
  LayoutDashboard,
  ClipboardList,
  FolderTree,
  DollarSign,
  ShieldAlert,
  ArrowLeft,
} from "lucide-react";

const ADMIN_NAV = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Listings", href: "/admin/listings", icon: ClipboardList },
  { label: "Categories", href: "/admin/categories", icon: FolderTree },
  { label: "Revenue", href: "/admin/revenue", icon: DollarSign },
  { label: "Reports", href: "/admin/reports", icon: ShieldAlert },
];

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
        <div className="px-4 py-4">
          <p className="mb-4 text-xs font-semibold uppercase text-text-tertiary tracking-wider">
            Admin
          </p>
          <nav className="flex flex-col gap-1" aria-label="Admin">
            {ADMIN_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
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
