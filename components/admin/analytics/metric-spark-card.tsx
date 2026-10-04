import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { percentDelta } from "@/lib/analytics/trend-series";
import { cn } from "@/lib/cn";

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const width = 96;
  const height = 32;
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-24 shrink-0" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" points={points} />
    </svg>
  );
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const delta = percentDelta(current, previous);
  if (delta === null) return null;
  const Icon = delta >= 0 ? TrendingUp : TrendingDown;
  return (
    <p
      className={cn(
        "mt-1 flex items-center gap-1 text-xs tabular-nums",
        delta > 0 && "text-emerald-500",
        delta < 0 && "text-neon-red-400",
        delta === 0 && "text-text-tertiary",
      )}
    >
      {delta === 0 ? null : <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      <span>{delta > 0 ? "Up" : delta < 0 ? "Down" : "No change"} {Math.abs(delta)}% vs previous period</span>
    </p>
  );
}

export function MetricSparkCard({
  label,
  value,
  current,
  previous,
  series,
  color,
}: {
  label: string;
  value: string;
  current?: number;
  previous?: number;
  series?: number[];
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-end justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-secondary">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-[-0.02em] tabular-nums text-text-primary">{value}</p>
          {current !== undefined && previous !== undefined ? (
            <Delta current={current} previous={previous} />
          ) : null}
        </div>
        {series && color ? <Sparkline values={series} color={color} /> : null}
      </CardContent>
    </Card>
  );
}
