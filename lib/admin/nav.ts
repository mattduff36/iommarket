import {
  LayoutDashboard,
  ClipboardList,
  FolderTree,
  DollarSign,
  ShieldAlert,
  Users,
  Store,
  MapPin,
  CreditCard,
  FileText,
  Settings,
  Image,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

export interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  group: "core" | "operations" | "content" | "insights";
}

export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard, group: "core" },
  { label: "Users", href: "/admin/users", icon: Users, group: "core" },
  { label: "Dealers", href: "/admin/dealers", icon: Store, group: "core" },
  { label: "Listings", href: "/admin/listings", icon: ClipboardList, group: "core" },
  { label: "Categories", href: "/admin/categories", icon: FolderTree, group: "core" },
  { label: "Regions", href: "/admin/regions", icon: MapPin, group: "core" },
  { label: "Reports", href: "/admin/reports", icon: ShieldAlert, group: "operations" },
  { label: "Payments", href: "/admin/payments", icon: CreditCard, group: "operations" },
  { label: "Revenue", href: "/admin/revenue", icon: DollarSign, group: "operations" },
  { label: "Pages", href: "/admin/pages", icon: FileText, group: "content" },
  { label: "Media", href: "/admin/media", icon: Image, group: "content" },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart3, group: "insights" },
  { label: "Settings", href: "/admin/settings", icon: Settings, group: "insights" },
];

export const ADMIN_NAV_GROUPS = [
  { key: "core" as const, label: "Core", accent: "text-neon-blue-400" },
  { key: "operations" as const, label: "Operations", accent: "text-neon-red-400" },
  { key: "content" as const, label: "Content", accent: "text-premium-gold-400" },
  { key: "insights" as const, label: "Insights", accent: "text-emerald-500" },
];
