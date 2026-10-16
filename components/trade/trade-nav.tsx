"use client";

import Link from "@/components/navigation/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const SECTIONS = [
  { label: "Browse", href: "/dealer/trade" },
  { label: "My stock", href: "/dealer/trade/stock" },
  { label: "New listing", href: "/dealer/trade/new" },
  { label: "Enquiries", href: "/dealer/trade/enquiries" },
  { label: "Saved searches", href: "/dealer/trade/saved" },
  { label: "Import", href: "/dealer/trade/import" },
] as const;

const ACTIONS = [
  { label: "New listing", href: "/dealer/trade/new" },
  { label: "Import stock", href: "/dealer/trade/import" },
] as const;

function linkIsCurrent(pathname: string, href: string) {
  if (href === "/dealer/trade") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function currentSection(pathname: string) {
  const matches = SECTIONS.filter((section) => linkIsCurrent(pathname, section.href));
  if (matches.length === 0) return null;
  return matches.reduce((longest, section) =>
    section.href.length > longest.href.length ? section : longest,
  );
}

export function TradeNav() {
  const pathname = usePathname() || "";
  const current = currentSection(pathname);
  const onBrowse = pathname === "/dealer/trade";

  return (
    <nav
      aria-label="Trade Exchange"
      className="mb-6 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Link
          href="/dealer/trade"
          aria-current={onBrowse ? "page" : undefined}
          className={cn(
            "hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500",
            onBrowse ? "font-medium text-text-primary" : "text-text-secondary hover:text-text-primary",
          )}
        >
          Trade Exchange
        </Link>
        {current && !onBrowse ? (
          <>
            <span aria-hidden="true" className="text-text-tertiary">
              /
            </span>
            <span aria-current="page" className="font-medium text-text-primary">
              {current.label}
            </span>
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((action) => {
          const active = linkIsCurrent(pathname, action.href);
          return (
            <Link
              key={action.href}
              href={action.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500",
                active
                  ? "border-border bg-surface font-medium text-text-primary"
                  : "border-border text-text-secondary hover:bg-surface hover:text-text-primary",
              )}
            >
              {action.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
