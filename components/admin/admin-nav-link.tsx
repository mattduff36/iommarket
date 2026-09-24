"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Ban,
  BarChart3,
  Bug,
  CarFront,
  ClipboardList,
  CreditCard,
  DollarSign,
  Eye,
  FileText,
  FolderTree,
  Image as ImageIcon,
  LayoutDashboard,
  ListTodo,
  Mail,
  MapPin,
  Receipt,
  Settings,
  ShieldAlert,
  Star,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AdminNavIcon, AdminNavItem } from "@/lib/admin/nav";
import { cn } from "@/lib/cn";

const NAV_ICONS: Record<AdminNavIcon, LucideIcon> = {
  analytics: BarChart3,
  audit: FileText,
  cancellations: Ban,
  categories: FolderTree,
  checklist: ListTodo,
  costs: Receipt,
  dashboard: LayoutDashboard,
  "dealer-onboarding": Mail,
  dealers: Store,
  listings: ClipboardList,
  media: ImageIcon,
  monitoring: Bug,
  pages: FileText,
  payments: CreditCard,
  "preview-packs": Eye,
  regions: MapPin,
  reports: ShieldAlert,
  revenue: DollarSign,
  reviews: Star,
  settings: Settings,
  users: Users,
  "vehicle-catalogue": CarFront,
  waitlist: Mail,
};

interface AdminNavLinkProps {
  item: AdminNavItem;
  accentClass: string;
  onNavigate?: () => void;
}

export function AdminNavLink({
  item,
  accentClass,
  onNavigate,
}: AdminNavLinkProps) {
  const pathname = usePathname();
  const Icon = NAV_ICONS[item.icon];
  const active =
    item.href === "/admin"
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        active
          ? "border-border bg-surface-elevated text-text-primary"
          : "border-transparent text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "h-4 w-4 shrink-0 transition-opacity",
          accentClass,
          active ? "opacity-100" : "opacity-55 group-hover:opacity-100",
        )}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
