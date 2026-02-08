"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Menu, X, Mail, Phone } from "lucide-react";
import { useState } from "react";
import { isClerkConfigured } from "@/lib/auth/clerk-config";

const NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Categories", href: "/categories" },
  { label: "Sell", href: "/sell" },
  { label: "Pricing", href: "/pricing" },
];

function AuthButtons() {
  if (!isClerkConfigured()) {
    return (
      <Button asChild variant="secondary" size="sm">
        <Link href="/sign-in">Sign In</Link>
      </Button>
    );
  }

  // Dynamic import to avoid loading Clerk when not configured
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SignedIn, SignedOut, UserButton, SignInButton } = require("@clerk/nextjs");

  return (
    <>
      <SignedIn>
        <UserButton
          afterSignOutUrl="/"
          appearance={{ elements: { avatarBox: "h-8 w-8" } }}
        />
      </SignedIn>
      <SignedOut>
        <SignInButton mode="modal">
          <Button variant="secondary" size="sm">
            Sign In
          </Button>
        </SignInButton>
      </SignedOut>
    </>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Top utility bar */}
      <div className="bg-slate-800 text-white">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between px-4 text-xs sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <Phone className="h-3 w-3" />
              Isle of Man Marketplace
            </span>
            <a href="mailto:hello@iommarket.im" className="inline-flex items-center gap-1.5 hover:text-royal-100 transition-colors">
              <Mail className="h-3 w-3" />
              <span className="hidden sm:inline">hello@iommarket.im</span>
            </a>
          </div>
          <div className="flex items-center gap-3 text-slate-300">
            <span className="text-xs">The Isle of Man&apos;s Trusted Marketplace</span>
          </div>
        </div>
      </div>

      {/* Main header */}
      <header className="sticky top-0 z-40 w-full bg-white shadow-sm">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo */}
          <Link
            href="/"
            className="shrink-0 flex items-center gap-2.5 text-2xl font-bold text-slate-900 tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Image
              src="/images/iom-flag.png"
              alt="Isle of Man flag"
              width={32}
              height={20}
              className="rounded-[3px] shadow-sm"
            />
            IOM Market
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
                    ? "text-royal-700"
                    : "text-slate-500 hover:text-slate-900"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right side: auth + mobile toggle */}
          <div className="flex items-center gap-3">
            <AuthButtons />
            <button
              type="button"
              className="md:hidden p-2 text-slate-500 hover:text-slate-900"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-slate-100 bg-white px-4 py-4">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "px-3 py-2.5 text-sm font-medium rounded-lg transition-colors",
                    pathname === item.href
                      ? "text-royal-700 bg-royal-50"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
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
