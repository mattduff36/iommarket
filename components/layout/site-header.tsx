"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Menu, X, Mail, Phone, ShieldCheck } from "lucide-react";
import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { HeaderAuthButtons, type AuthState } from "@/components/auth/header-auth-buttons";

const NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Categories", href: "/categories" },
  { label: "Sell", href: "/sell" },
  { label: "Pricing", href: "/pricing" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    displayName: null,
    role: null,
    loading: true,
    handleSignOut,
  });

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    setMobileOpen(false);
    router.push("/");
    router.refresh();
  }

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      setAuthState((s) => ({ ...s, loading: false }));
      return;
    }

    const supabase = createSupabaseBrowserClient();

    async function fetchMe(userEmail: string | null | undefined) {
      try {
        const res = await fetch("/api/me", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json();
        const displayName = data.name?.trim() || userEmail || null;
        setAuthState((s) => ({ ...s, role: data.role ?? null, displayName }));
      } catch {
        // silently fail
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setAuthState((s) => ({
        ...s,
        user: u,
        loading: false,
        displayName: u?.email ?? null,
      }));
      if (u) fetchMe(u.email);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      if (!u) {
        setAuthState((s) => ({ ...s, user: null, role: null, displayName: null }));
      } else {
        setAuthState((s) => ({ ...s, user: u, displayName: u.email ?? null }));
        fetchMe(u.email);
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { user, role } = authState;
  const isDealer = role === "DEALER" || role === "ADMIN";

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
            <HeaderAuthButtons authState={{ ...authState, handleSignOut }} />
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

            {/* ── Nav links ── */}
            <nav className="flex flex-col gap-1 mb-3" aria-label="Mobile">
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

            {/* ── Divider ── */}
            <div className="border-t border-border mb-3" />

            {/* ── Account section ── */}
            {user ? (
              <div className="flex flex-col gap-1">
                <Link
                  href="/account/favourites"
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2.5 text-sm font-medium rounded-sm text-metallic-400 hover:text-text-primary hover:bg-surface-elevated transition-colors"
                >
                  Saved listings
                </Link>
                <Link
                  href="/account/saved-searches"
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2.5 text-sm font-medium rounded-sm text-metallic-400 hover:text-text-primary hover:bg-surface-elevated transition-colors"
                >
                  Saved searches
                </Link>
                {isDealer && (
                  <Link
                    href="/dealer/dashboard"
                    onClick={() => setMobileOpen(false)}
                    className="px-3 py-2.5 text-sm font-medium rounded-sm text-metallic-400 hover:text-text-primary hover:bg-surface-elevated transition-colors"
                  >
                    Dealer dashboard
                  </Link>
                )}
                <Link
                  href="/account/change-password"
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2.5 text-sm font-medium rounded-sm text-metallic-400 hover:text-text-primary hover:bg-surface-elevated transition-colors"
                >
                  Change password
                </Link>
                <button
                  onClick={handleSignOut}
                  className="text-left px-3 py-2.5 text-sm font-medium rounded-sm text-metallic-400 hover:text-text-primary hover:bg-surface-elevated transition-colors"
                >
                  Sign out
                </button>
                {role === "ADMIN" && (
                  <>
                    <div className="border-t border-border my-2" />
                    <Link
                      href="/admin"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-sm text-red-400 hover:text-red-300 hover:bg-surface-elevated transition-colors"
                    >
                      <ShieldCheck className="h-4 w-4 shrink-0" />
                      Admin area
                    </Link>
                  </>
                )}
              </div>
            ) : (
              <div>
                <Link
                  href="/sign-up"
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2.5 text-sm font-medium rounded-sm text-metallic-400 hover:text-text-primary hover:bg-surface-elevated transition-colors"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        )}
      </header>
    </>
  );
}
