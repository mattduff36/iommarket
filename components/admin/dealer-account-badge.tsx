import type { ReactNode } from "react";

/** Shared package identity; funding and verification belong beneath/beside it. */
export function DealerAccountBadge({ children }: { children: ReactNode }) {
  return <span className="inline-flex whitespace-nowrap rounded border border-[#d88b8b]/[.28] bg-[#d88b8b]/[.08] px-2 py-0.5 text-[11px] font-semibold text-[#d88b8b]">{children}</span>;
}
