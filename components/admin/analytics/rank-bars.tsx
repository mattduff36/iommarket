"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { CHART_TICK, CHART_USERS } from "@/components/admin/analytics/chart-colors";

function shortLabel(value: unknown): string {
  const label = String(value ?? "");
  return label.length > 22 ? `${label.slice(0, 21)}...` : label;
}

function countLabel(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString("en-GB") : "";
}

export function RankBars({
  items,
  color = CHART_USERS,
  emptyLabel,
}: {
  items: Array<{ name: string; count: number }>;
  color?: string;
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-text-tertiary">{emptyLabel}</p>;
  }
  const height = Math.max(148, items.length * 36);
  return (
    <div className={items.length > 10 ? "max-h-80 overflow-y-auto" : undefined}>
      <ul className="sr-only">
        {items.map((item) => (
          <li key={item.name}>{item.name}: {item.count.toLocaleString("en-GB")}</li>
        ))}
      </ul>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height }}>
          <BarChart data={items} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={132}
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_TICK, fontSize: 12 }}
              tickFormatter={shortLabel}
            />
            <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} barSize={10} isAnimationActive={false}>
              <LabelList dataKey="count" position="right" fill={CHART_TICK} fontSize={12} formatter={countLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
