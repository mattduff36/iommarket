"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const LINKS = [
  ["Browse", "/dealer/trade"],
  ["My stock", "/dealer/trade/stock"],
  ["New listing", "/dealer/trade/new"],
  ["Enquiries", "/dealer/trade/enquiries"],
  ["Saved searches", "/dealer/trade/saved"],
  ["Import", "/dealer/trade/import"],
] as const;

function linkIsCurrent(pathname: string, href: string) {
  if (href === "/dealer/trade") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TradeNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Trade Exchange" className="mb-6 flex max-w-full flex-wrap gap-2">
      {LINKS.map(([label, href]) => {
        const active = linkIsCurrent(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500",
              active
                ? "border-neon-blue-500 bg-surface font-medium text-text-primary"
                : "border-border text-text-primary hover:bg-surface",
            )}
          >
            {label}
          </Link>
        );
      })}
      <Link
        href="/dealer/dashboard"
        className="rounded-full px-3 py-1.5 text-sm text-text-trust underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500"
      >
        Dashboard
      </Link>
    </nav>
  );
}
