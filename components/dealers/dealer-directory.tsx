import Link from "next/link";
import { Store } from "lucide-react";
import { DealerCard } from "@/components/dealers/dealer-card";
import type { DealerSpotlight } from "@/lib/dealers/spotlights";

interface DealerDirectoryProps {
  dealers: DealerSpotlight[];
}

export function DealerDirectory({ dealers }: DealerDirectoryProps) {
  if (dealers.length === 0) {
    return (
      <div
        role="status"
        className="rounded-[28px] border border-dashed border-border bg-surface/60 px-5 py-14 text-center sm:px-8"
      >
        <Store
          aria-hidden="true"
          className="mx-auto h-10 w-10 text-metallic-500"
        />
        <h2 className="mt-5 text-xl font-semibold text-text-primary font-heading">
          No dealers are currently listed
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
          Approved dealer profiles will appear here when they become available.
        </p>
        <Link
          href="/search"
          className="mt-5 inline-flex text-sm text-text-trust transition-colors hover:text-neon-blue-400"
        >
          Browse all vehicles
        </Link>
      </div>
    );
  }

  return (
    <section aria-labelledby="dealer-directory-heading">
      <h2 id="dealer-directory-heading" className="sr-only">
        Dealer directory
      </h2>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {dealers.map((dealer) => (
          <DealerCard key={dealer.id} dealer={dealer} />
        ))}
      </div>
    </section>
  );
}
