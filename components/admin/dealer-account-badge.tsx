import type { DealerTier } from "@prisma/client";
import type { ReactNode } from "react";

const tierColors: Record<DealerTier, string> = {
  PRO: "border-[#683637] bg-[#382023] text-[#ff8383]",
  STARTER: "border-[#513538] bg-[#23191b] text-[#cf9696]",
};
const defaultColors = "border-[#d88b8b]/[.28] bg-[#d88b8b]/[.08] text-[#d88b8b]";

/** Shared package identity; funding and verification belong beneath/beside it. */
export function DealerAccountBadge({ children, tier }: { children: ReactNode; tier?: DealerTier }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-semibold ${tier ? tierColors[tier] : defaultColors}`}>
      {children}
    </span>
  );
}
