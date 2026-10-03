"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { TrendPoint } from "@/lib/analytics/trend-series";
import {
  CHART_GRID,
  CHART_LISTING_VIEWS,
  CHART_PAGEVIEWS,
  CHART_SURFACE,
  CHART_TICK,
  CHART_USERS,
} from "@/components/admin/analytics/chart-colors";

const SERIES = [
  { key: "users", name: "Users", color: CHART_USERS },
  { key: "pageviews", name: "Pageviews", color: CHART_PAGEVIEWS },
  { key: "listingViews", name: "Listing views", color: CHART_LISTING_VIEWS },
] as const;

function TrendTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border px-3 py-2 shadow-high" style={{ background: CHART_SURFACE }}>
      <p className="text-xs text-text-secondary">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {payload.map((item) => (
          <li key={String(item.dataKey)} className="flex items-center justify-between gap-4 text-sm tabular-nums text-text-primary">
            <span className="text-text-secondary">{item.name}</span>
            <span>{Number(item.value ?? 0).toLocaleString("en-GB")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrendChart({
  points,
  includeVisitors,
}: {
  points: TrendPoint[];
  includeVisitors: boolean;
}) {
  const series = includeVisitors ? SERIES : SERIES.filter((item) => item.key === "listingViews");
  const hasActivity = points.some((point) => series.some((item) => point[item.key] > 0));
  if (!hasActivity) {
    return <p className="text-sm text-text-tertiary">No daily activity in this range yet.</p>;
  }
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="h-2 w-2 rounded-full" style={{ background: item.color }} aria-hidden="true" />
            {item.name}
          </li>
        ))}
      </ul>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 288 }}>
          <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: CHART_TICK, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
            <YAxis tick={{ fill: CHART_TICK, fontSize: 11 }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip content={TrendTooltip} cursor={{ stroke: CHART_TICK, strokeDasharray: "3 3" }} />
            {series.map((item) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.name}
                stroke={item.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: item.color }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
