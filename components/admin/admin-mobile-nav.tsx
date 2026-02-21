"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Menu,
  LayoutDashboard,
  ClipboardList,
  FolderTree,
  DollarSign,
  ArrowLeft,
} from "lucide-react";

const ADMIN_NAV = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Listings", href: "/admin/listings", icon: ClipboardList },
  { label: "Categories", href: "/admin/categories", icon: FolderTree },
  { label: "Revenue", href: "/admin/revenue", icon: DollarSign },
];

export function AdminMobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Open admin menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="text-sm font-semibold text-text-primary">Admin</span>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="fixed left-0 top-0 h-full w-64 translate-x-0 translate-y-0 rounded-none data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left max-w-none">
          <DialogTitle className="sr-only">Admin Navigation</DialogTitle>
          <div className="flex h-16 items-center border-b border-border px-6">
            <Link
              href="/"
              onClick={() => setOpen(false)}
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
            <nav className="flex flex-col gap-1" aria-label="Admin mobile">
              {ADMIN_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
