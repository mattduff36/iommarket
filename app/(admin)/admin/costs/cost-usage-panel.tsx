"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMarkedGbp } from "@/lib/costs/format";
import type { CostLineDto } from "@/lib/costs/dto";
import {
  COST_USAGE_RANGE_LABELS,
  COST_USAGE_RANGES,
  COST_USAGE_SERIES_COLORS,
  buildCostUsageModel,
  type CostUsageRange,
} from "@/lib/costs/usage-view";
import { CostSectionTable } from "./cost-section-table";
import { CostUsageChart } from "./cost-usage-chart";

export function CostUsagePanel({
  sections,
}: {
  sections: Array<{
    key: string;
    label: string;
    amountLabel: string;
    lines: CostLineDto[];
  }>;
}) {
  const [range, setRange] = useState<CostUsageRange>("all");
  const allLines = useMemo(
    () => sections.flatMap((section) => section.lines),
    [sections],
  );
  const model = useMemo(
    () => buildCostUsageModel({ lines: allLines, range }),
    [allLines, range],
  );
  const visibleSections = sections
    .map((section) => ({
      ...section,
      lines: model.filteredLines.filter((line) => line.category === section.key),
    }))
    .filter((section) => section.lines.length > 0)
    .map((section) => ({
      ...section,
      amountLabel: formatMarkedGbp(
        section.lines.reduce((total, line) => total + line.amountMinor, 0),
      ),
    }));

  return (
    <div className="mb-8 space-y-6">
      <section className="rounded-lg border border-border bg-surface p-4 shadow-low sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Usage</h2>
            <p className="text-sm text-text-secondary">{model.rangeLabel}</p>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Usage period">
            {COST_USAGE_RANGES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={range === value}
                onClick={() => setRange(value)}
                className={
                  range === value
                    ? "rounded-md bg-surface-elevated px-2.5 py-1 text-sm font-medium text-text-primary"
                    : "rounded-md px-2.5 py-1 text-sm text-text-secondary hover:bg-surface-elevated"
                }
              >
                {COST_USAGE_RANGE_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <SummaryCard title="Total" value={model.totalLabel} />
          <SummaryCard title="Included" value={model.includedLabel} />
          <SummaryCard title="On-demand" value={model.onDemandLabel} />
        </div>

        <div>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-text-primary">Project costs</h3>
              <p className="text-sm text-text-secondary">
                Cumulative spend by included usage, on-demand usage, and infrastructure.
              </p>
            </div>
            <p className="text-xs text-text-secondary">Grouped by category</p>
          </div>
          <CostUsageChart points={model.points} seriesKeys={model.seriesKeys} />
          {model.seriesKeys.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-secondary">
              {model.seriesKeys.map((key) => (
                <li key={key} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: COST_USAGE_SERIES_COLORS[key] }}
                    aria-hidden
                  />
                  {key}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {visibleSections.map((section) => (
        <CostSectionTable
          key={section.key}
          label={section.label}
          amountLabel={section.amountLabel}
          lines={section.lines}
        />
      ))}
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-text-secondary">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums text-text-primary">{value}</p>
      </CardContent>
    </Card>
  );
}
