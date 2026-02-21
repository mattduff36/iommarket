"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Menu, X, Mail, Phone } from "lucide-react";
import { useState } from "react";
import { HeaderAuthButtons } from "@/components/auth/header-auth-buttons";

const NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Categories", href: "/categories" },
  { label: "Sell", href: "/sell" },
  { label: "Pricing", href: "/pricing" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Top utility bar — hidden on small mobile to save vertical space */}
      <div className="hidden sm:block bg-graphite-950 text-text-secondary">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between px-4 text-xs sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <Phone className="h-3 w-3" />
              Isle of Man Vehicle Sales
            </span>
            <a
              href="mailto:hello@itrader.im"
              className="inline-flex items-center gap-1.5 hover:text-neon-blue-400 transition-colors"
            >
              <Mail className="h-3 w-3" />
              <span className="hidden sm:inline">hello@itrader.im</span>
            </a>
          </div>
          <div className="flex items-center gap-3 text-metallic-400">
            <span className="text-xs">The Isle of Man&apos;s Trusted Vehicle Marketplace</span>
          </div>
        </div>
      </div>

      {/* Main header — glass surface + neon trust border */}
      <header
        className={cn(
          "sticky top-0 z-40 w-full h-16 sm:h-20",
          "glass-surface border-b border-neon-blue-500/40",
        )}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo */}
          <Link href="/" className="shrink-0 flex items-center">
            <Image
              src="/images/logo-itrader.png"
              alt="iTrader.im – Buy · Sell · Upgrade"
              width={220}
              height={74}
              className="h-9 sm:h-12 w-auto"
              priority
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8" aria-label="Main">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "text-sm font-medium transition-colors",
                  pathname === item.href
                    ? "text-neon-blue-400"
                    : "text-metallic-400 hover:text-text-primary",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <HeaderAuthButtons />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-border bg-surface px-4 py-4">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "px-3 py-2.5 text-sm font-medium rounded-sm transition-colors",
                    pathname === item.href
                      ? "text-neon-blue-400 bg-neon-blue-500/10"
                      : "text-metallic-400 hover:text-text-primary hover:bg-surface-elevated",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        )}
      </header>
    </>
  );
}
