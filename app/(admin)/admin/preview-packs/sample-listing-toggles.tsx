"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSampleListingVisibility } from "@/actions/admin/preview-controls";
import { Switch } from "@/components/ui/switch";

const SAMPLE_ROWS = [
  { kind: "private" as const, label: "Private sample listings" },
  { kind: "dealer" as const, label: "Dealer sample listings" },
] as const;

export function SampleListingToggles({
  samplePrivateVisible,
  sampleDealerVisible,
}: {
  samplePrivateVisible: boolean;
  sampleDealerVisible: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState({
    private: samplePrivateVisible,
    dealer: sampleDealerVisible,
  });

  useEffect(() => {
    setVisible({
      private: samplePrivateVisible,
      dealer: sampleDealerVisible,
    });
  }, [samplePrivateVisible, sampleDealerVisible]);

  function handleToggle(kind: "private" | "dealer", nextVisible: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setSampleListingVisibility({ kind, visible: nextVisible });
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      setVisible((current) => ({ ...current, [kind]: nextVisible }));
      router.refresh();
    });
  }

  return (
    <section
      className="mb-8 rounded-lg border border-border bg-surface p-4 sm:p-6"
      aria-labelledby="sample-listings-heading"
    >
      <div className="mb-4">
        <h2 id="sample-listings-heading" className="text-lg font-semibold text-text-primary">
          Sample listings
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Show or hide placeholder private and dealer listings used for admin
          marketplace preview.
        </p>
      </div>
      <div className="divide-y divide-border">
        {SAMPLE_ROWS.map((row) => {
          const enabled = visible[row.kind];
          return (
            <div
              key={row.kind}
              className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <span className="text-sm font-medium text-text-primary">{row.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-primary">{enabled ? "On" : "Off"}</span>
                <Switch
                  checked={enabled}
                  disabled={isPending}
                  onCheckedChange={(next) => handleToggle(row.kind, next)}
                  aria-label={row.label}
                />
              </div>
            </div>
          );
        })}
      </div>
      {error ? <p className="mt-3 text-sm text-text-error">{error}</p> : null}
    </section>
  );
}
