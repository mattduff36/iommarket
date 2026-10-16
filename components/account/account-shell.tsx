"use client";

import { NavigationContent } from "@/components/navigation/navigation-pending";

import { useState } from "react";
import Link from "@/components/navigation/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ClipboardList,
  CreditCard,
  Heart,
  LayoutDashboard,
  Mail,
  Menu,
  Search,
  Star,
  Store,
  UserRound,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@prisma/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import styles from "@/components/account/account-shell.module.css";

type AccountNavGroup = "account" | "dealer" | "trade";

interface AccountNavItem {
  label: string;
  href: string;
  group: AccountNavGroup;
  icon: LucideIcon;
  exact?: boolean;
}

const NAV_GROUPS: Array<{ key: AccountNavGroup; label: string; accent: string }> = [
  { key: "account", label: "Account", accent: "text-neon-blue-400" },
  { key: "dealer", label: "Dealer", accent: "text-premium-gold-400" },
  { key: "trade", label: "Trade", accent: "text-emerald-500" },
];

const ACCOUNT_NAV: AccountNavItem[] = [
  { label: "Overview", href: "/account", group: "account", icon: LayoutDashboard, exact: true },
  { label: "My listings", href: "/account/listings", group: "account", icon: ClipboardList },
  { label: "Saved listings", href: "/account/favourites", group: "account", icon: Heart },
  { label: "Saved searches", href: "/account/saved-searches", group: "account", icon: Search },
  { label: "Profile & security", href: "/account/profile", group: "account", icon: UserRound },
  { label: "Notifications", href: "/account/notifications", group: "account", icon: Bell },
  { label: "Dealer overview", href: "/dealer/dashboard", group: "dealer", icon: LayoutDashboard, exact: true },
  { label: "Dealer listings", href: "/dealer/listings", group: "dealer", icon: ClipboardList },
  { label: "Dealer profile", href: "/dealer/profile", group: "dealer", icon: Store },
  { label: "Reviews", href: "/dealer/reviews", group: "dealer", icon: Star },
  { label: "Subscription", href: "/dealer/subscription", group: "dealer", icon: CreditCard },
  { label: "Email delivery", href: "/dealer/email-settings", group: "dealer", icon: Mail },
  { label: "Browse", href: "/dealer/trade", group: "trade", icon: Search, exact: true },
  { label: "Own stock", href: "/dealer/trade/stock", group: "trade", icon: Warehouse },
  { label: "Enquiries", href: "/dealer/trade/enquiries", group: "trade", icon: Mail },
  { label: "Saved", href: "/dealer/trade/saved", group: "trade", icon: Heart },
];

export interface AccountShellProps {
  role: UserRole;
  name: string | null;
  dealerSlug: string | null;
  tradeEnabled: boolean;
  children: React.ReactNode;
}

export function isAccountChromeBypassed(pathname: string): boolean {
  return (
    pathname === "/account/accept-policies" ||
    pathname.startsWith("/account/accept-policies/") ||
    pathname === "/dealer/onboarding" ||
    pathname.startsWith("/dealer/onboarding/") ||
    pathname === "/dealer/correspondence/verify" ||
    pathname.startsWith("/dealer/correspondence/verify/")
  );
}

export function accountNavForRole(role: UserRole, tradeEnabled: boolean): AccountNavItem[] {
  return ACCOUNT_NAV.filter((item) => {
    if (item.group === "account") return true;
    if (role !== "DEALER") return false;
    if (item.group === "trade") return tradeEnabled;
    return true;
  });
}

export function activeAccountHref(pathname: string, items: AccountNavItem[]): string | null {
  const matches = items.filter((item) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (matches.length === 0) return null;
  return matches.reduce((longest, item) =>
    item.href.length > longest.href.length ? item : longest,
  ).href;
}

function AccountNavLinks({
  items,
  activeHref,
  onNavigate,
}: {
  items: AccountNavItem[];
  activeHref: string | null;
  onNavigate?: () => void;
}) {
  return (
    <>
      {NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group.key);
        if (groupItems.length === 0) return null;
        return (
          <div key={group.key}>
            <p className={`mb-2 text-xs font-semibold uppercase tracking-wider ${group.accent}`}>
              {group.label}
            </p>
            <nav className="flex flex-col gap-0.5" aria-label={group.label}>
              {groupItems.map((item) => {
                const Icon = item.icon;
                const active = item.href === activeHref;
                return (
                  <Link
                    key={item.href}
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
                        group.accent,
                        active ? "opacity-100" : "opacity-55 group-hover:opacity-100",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        );
      })}
    </>
  );
}

function AccountNavFooter({
  dealerSlug,
  showPublicProfile,
  onNavigate,
}: {
  dealerSlug: string | null;
  showPublicProfile: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="mt-6 border-t border-border pt-4">
      {showPublicProfile && dealerSlug ? (
        <Link
          href={`/dealers/${dealerSlug}`}
          onClick={onNavigate}
          className="mb-2 block truncate text-xs text-text-secondary hover:text-text-primary hover:underline"
        >
          Public profile
        </Link>
      ) : null}
      <Link
        href="/"
        onClick={onNavigate}
        className="block text-xs text-text-secondary hover:text-text-primary hover:underline"
      >
        Marketplace
      </Link>
    </div>
  );
}

function AccountMobileNav({
  items,
  activeHref,
  title,
  dealerSlug,
  showPublicProfile,
}: {
  items: AccountNavItem[];
  activeHref: string | null;
  title: string;
  dealerSlug: string | null;
  showPublicProfile: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="sticky top-16 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 sm:top-20 lg:hidden">
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Open account menu">
            <Menu className="h-5 w-5" />
          </Button>
        </DialogTrigger>
        <span className="truncate text-sm font-semibold text-text-primary">{title}</span>
      </div>
      <DialogContent overlayClassName="bg-black/25 backdrop-blur-[2px]" className="fixed left-0 top-0 flex h-dvh max-h-dvh w-[224px] max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none p-0 pt-[env(safe-area-inset-top)] data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left [&>button]:right-[calc(1rem+env(safe-area-inset-right))] [&>button]:top-[calc(1rem+env(safe-area-inset-top))]">
        <DialogTitle className="sr-only">Account navigation</DialogTitle>
        <DialogDescription className="sr-only">
          Browse account, dealer, and trade links.
        </DialogDescription>
        <div className="flex h-16 shrink-0 items-center border-b border-border px-6 pr-14">
          <span className="truncate text-sm font-semibold text-text-primary">{title}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] touch-pan-y">
          <AccountNavLinks
            items={items}
            activeHref={activeHref}
            onNavigate={() => setOpen(false)}
          />
          <AccountNavFooter
            dealerSlug={dealerSlug}
            showPublicProfile={showPublicProfile}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AccountShell({
  role,
  name,
  dealerSlug,
  tradeEnabled,
  children,
}: AccountShellProps) {
  const pathname = usePathname() || "";
  if (isAccountChromeBypassed(pathname)) return children;

  const items = accountNavForRole(role, tradeEnabled);
  const activeHref = activeAccountHref(pathname, items);
  const title = name || "Account";
  const showPublicProfile = role === "DEALER" && Boolean(dealerSlug);

  return (
    <div className="flex min-w-0 flex-1">
      <aside className={`${styles.sidebar} hidden shrink-0 border-r border-border bg-surface lg:block`}>
        <div className="sticky top-20 max-h-[calc(100vh-5rem)] space-y-5 overflow-y-auto px-4 py-4">
          <p className="truncate text-sm font-semibold text-text-primary">{title}</p>
          <AccountNavLinks items={items} activeHref={activeHref} />
          <AccountNavFooter dealerSlug={dealerSlug} showPublicProfile={showPublicProfile} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        <AccountMobileNav
          items={items}
          activeHref={activeHref}
          title={title}
          dealerSlug={dealerSlug}
          showPublicProfile={showPublicProfile}
        />
        <NavigationContent className={styles.content}>{children}</NavigationContent>
      </div>
    </div>
  );
}
