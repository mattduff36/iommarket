"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import styles from "./admin-mobile-nav.module.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ADMIN_NAV, ADMIN_NAV_GROUPS, type AdminNavItem } from "@/lib/admin/nav";
import { AdminNavLink } from "@/components/admin/admin-nav-link";

export function AdminMobileNav({ items: navigation = ADMIN_NAV.filter((item) => item.icon !== "checklist") }: { items?: AdminNavItem[] }) {
  const [open, setOpen] = useState(false);
  const [triggerHost, setTriggerHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTriggerHost(document.getElementById("admin-mobile-menu-trigger"));
    const desktop = window.matchMedia("(min-width: 1024px)");
    const breakpoint = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", breakpoint);
    return () => desktop.removeEventListener("change", breakpoint);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerHost ? createPortal(<DialogTrigger asChild>
        <Button type="button" variant="ghost" aria-label="Open admin menu"
          title="Admin menu" className={styles.trigger}>
          <Image src="/images/logo-admin-menu.png" alt="" width={640} height={149}
            className={styles.logo} />
        </Button>
      </DialogTrigger>, triggerHost) : null}

      <DialogContent overlayClassName="bg-black/25 backdrop-blur-[2px]" className={`${styles.drawer} fixed left-0 top-0 flex h-dvh max-h-dvh w-64 max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none p-0 pt-[env(safe-area-inset-top)] [&>button]:right-[calc(1rem+env(safe-area-inset-right))] [&>button]:top-[calc(1rem+env(safe-area-inset-top))] [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center`}>
        <DialogTitle className="sr-only">Admin Navigation</DialogTitle>
        <DialogDescription className="sr-only">
          Browse the admin navigation links.
        </DialogDescription>
        <div className="flex h-16 shrink-0 items-center border-b border-border px-6 pr-14">
          <span className="text-sm font-semibold text-text-primary">Admin</span>
        </div>
        <div
          role="region"
          aria-label="Admin navigation"
          data-scroll-region="admin-navigation"
          className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] touch-pan-y"
        >
          {ADMIN_NAV_GROUPS.map((group) => {
            const items = navigation.filter((i) => i.group === group.key);
            if (items.length === 0) return null;
            return (
              <div key={group.key}>
                <p className={`mb-2 text-xs font-semibold uppercase tracking-wider ${group.accent}`}>
                  {group.label}
                </p>
                <nav className="flex flex-col gap-0.5" aria-label={`${group.label} mobile`}>
                  {items.map((item) => (
                    <AdminNavLink
                      key={item.href}
                      item={item}
                      accentClass={group.accent}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </nav>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
