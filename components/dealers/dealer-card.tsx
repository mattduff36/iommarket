import { ArrowUpRight } from "lucide-react";
import { DealerLogo } from "@/components/dealers/dealer-logo";
import { NAVIGABLE_CARD_LINK_CLASS } from "@/components/ui/card-overlay-link";
import { cn } from "@/lib/cn";
import type { DealerSpotlight } from "@/lib/dealers/spotlights";
import Link from "next/link";

interface DealerCardProps {
  dealer: DealerSpotlight;
  className?: string;
}

export function DealerCard({ dealer, className }: DealerCardProps) {
  return (
    <Link
      href={`/dealers/${dealer.slug}`}
      aria-label={`Visit ${dealer.name} profile`}
      className={cn(
        "group flex h-full min-w-0 flex-col rounded-2xl border border-border bg-black/20 p-4 transition-colors hover:border-neon-blue-500/40",
        NAVIGABLE_CARD_LINK_CLASS,
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <DealerLogo
          logoUrl={dealer.logoUrl}
          dealerName={dealer.name}
          className="h-14 w-14 rounded-xl border border-white/10 bg-graphite-800 text-lg"
        />
        <h3 className="min-w-0 text-base font-semibold text-text-primary">
          {dealer.name}
        </h3>
      </div>

      <p className="mt-4 line-clamp-4 text-sm leading-6 text-text-secondary">
        {dealer.bio ?? "Trusted Isle of Man dealer."}
      </p>

      <div className="mt-auto pt-5">
        <p className="text-xs uppercase tracking-[0.18em] text-metallic-500">
          {dealer._count.listings} live{" "}
          {dealer._count.listings === 1 ? "listing" : "listings"}
        </p>
        <span
          aria-hidden="true"
          className="mt-3 inline-flex items-center gap-1 text-sm text-text-trust transition-colors group-hover:text-neon-blue-400"
        >
          Visit profile
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}
