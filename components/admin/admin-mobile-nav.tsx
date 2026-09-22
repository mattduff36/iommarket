"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { ADMIN_NAV, ADMIN_NAV_GROUPS } from "@/lib/admin/nav";

export function AdminMobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="sticky top-16 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 sm:top-20 lg:hidden">
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open admin menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </DialogTrigger>
        <span className="text-sm font-semibold text-text-primary">Admin</span>
      </div>

      <DialogContent className="fixed left-0 top-0 flex h-dvh max-h-dvh w-64 max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none p-0 pt-[env(safe-area-inset-top)] data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left [&>button]:right-[calc(1rem+env(safe-area-inset-right))] [&>button]:top-[calc(1rem+env(safe-area-inset-top))]">
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
            const items = ADMIN_NAV.filter((i) => i.group === group.key);
            if (items.length === 0) return null;
            return (
              <div key={group.key}>
                <p className={`mb-2 text-xs font-semibold uppercase tracking-wider ${group.accent}`}>
                  {group.label}
                </p>
                <nav className="flex flex-col gap-0.5" aria-label={`${group.label} mobile`}>
                  {items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
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
      </DialogContent>
    </Dialog>
  );
}
