import Link from "next/link";
import { DealerCard } from "@/components/dealers/dealer-card";
import type { DealerSpotlight } from "@/lib/dealers/spotlights";

interface DealerSpotlightsProps {
  dealers: DealerSpotlight[];
}

export function DealerSpotlights({ dealers }: DealerSpotlightsProps) {
  return (
    <div className="min-w-0 rounded-[28px] border border-border bg-surface p-5 sm:p-6">
      <div className="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="section-heading-accent text-xl font-bold text-text-primary font-heading sm:text-2xl">
            Dealer Spotlights
          </h2>
          <p className="mt-2 text-sm text-text-secondary">
            Trusted Isle of Man dealers with fresh stock and active profiles.
          </p>
        </div>
        <Link
          href="/dealers"
          className="shrink-0 text-sm text-text-trust transition-colors hover:text-neon-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-400"
        >
          View all dealers
        </Link>
      </div>

      {dealers.length > 0 ? (
        <div
          role="region"
          aria-label="Dealer spotlights"
          tabIndex={0}
          className="-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-400"
        >
          <div className="flex min-w-full snap-x snap-mandatory gap-3">
            {dealers.map((dealer) => (
              <DealerCard
                key={dealer.id}
                dealer={dealer}
                className="w-[85%] shrink-0 snap-start sm:w-[48%] lg:w-[calc((100%_-_1.5rem)/3)]"
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-text-secondary">
          Dealer profiles will appear here as they become available.
        </p>
      )}
    </div>
  );
}
