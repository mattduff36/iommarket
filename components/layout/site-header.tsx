"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/marketplace/search-bar";
import { Menu, X } from "lucide-react";
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

  function handleSearch(value: string) {
    if (value.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(value.trim())}`;
    }
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link
          href="/"
          className="shrink-0 text-xl font-bold text-text-brand"
        >
          IOM Market
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-3 py-2 text-sm font-medium rounded-md transition-colors",
                pathname === item.href
                  ? "text-text-brand bg-royal-50"
                  : "text-text-secondary hover:text-text-primary hover:bg-slate-50"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Search */}
        <div className="hidden md:block flex-1 max-w-md">
          <SearchBar
            placeholder="Search listings..."
            onSearch={handleSearch}
          />
        </div>

        {/* Auth buttons */}
        <div className="ml-auto flex items-center gap-2">
          <AuthButtons />
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="md:hidden p-2 text-text-secondary"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-surface px-4 py-4">
          <SearchBar
            placeholder="Search listings..."
            onSearch={handleSearch}
            className="mb-4"
          />
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "px-3 py-2 text-sm font-medium rounded-md",
                  pathname === item.href
                    ? "text-text-brand bg-royal-50"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
