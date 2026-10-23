"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./admin-mobile-nav.module.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { ADMIN_NAV, ADMIN_NAV_GROUPS, type AdminNavItem } from "@/lib/admin/nav";
import { AdminNavLink } from "@/components/admin/admin-nav-link";

export function AdminMobileNav({ items: navigation = ADMIN_NAV.filter((item) => item.icon !== "checklist") }: { items?: AdminNavItem[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dockOffset, setDockOffset] = useState(0);

  useEffect(() => {
    setMounted(true);
    const desktop = window.matchMedia("(min-width: 1024px)");
    const breakpoint = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", breakpoint);
    // Keep the trigger above the optional stock progress dock on mobile.
    let dock: Element | null = null;
    const measure = () => {
      const visibleDock = dock instanceof HTMLElement && !dock.hidden && !desktop.matches ? dock : null;
      setDockOffset(visibleDock ? Math.max(0, window.innerHeight - visibleDock.getBoundingClientRect().top + 12) : 0);
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const syncDock = () => {
      const next = document.querySelector("[data-stock-worker-dock]");
      if (next !== dock) { if (dock) resize?.unobserve(dock); dock = next; if (dock) resize?.observe(dock); }
      measure();
    };
    const changes = new MutationObserver(syncDock);
    changes.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("resize", measure);
    syncDock();
    return () => { desktop.removeEventListener("change", breakpoint); window.removeEventListener("resize", measure); resize?.disconnect(); changes.disconnect(); };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {mounted ? createPortal(<DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Open admin menu"
          title="Admin menu" className={styles.trigger}
          style={dockOffset ? { bottom: dockOffset } : undefined}>
          <Menu className="h-6 w-6" aria-hidden="true" />
        </Button>
      </DialogTrigger>, document.body) : null}

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
