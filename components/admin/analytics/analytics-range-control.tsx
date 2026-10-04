import { cn } from "@/lib/cn";

const RANGES = ["7d", "30d", "90d"] as const;

export function AnalyticsRangeControl({ current }: { current: string }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-canvas/40 p-0.5" aria-label="Date range">
      {RANGES.map((option) => {
        const active = current === option;
        return (
          <a
            key={option}
            href={`/admin/analytics?range=${option}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-blue-500",
              active
                ? "bg-surface font-semibold text-text-primary shadow-low"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            {option}
          </a>
        );
      })}
    </div>
  );
}
