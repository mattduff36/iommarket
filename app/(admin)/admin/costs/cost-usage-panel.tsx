"use client";

import { useMemo, useState } from "react";
import { buildCostAuditView } from "@/lib/costs/audit-view";
import { formatMarkedGbp } from "@/lib/costs/format";
import type { CostLineDto, CursorAuditDto } from "@/lib/costs/dto";
import {
  COST_USAGE_RANGE_LABELS,
  COST_USAGE_RANGES,
  costSeriesColor,
  buildCostUsageModel,
  summarizeCostLines,
  type CostBillingDisplay,
  type CostUsageRange,
} from "@/lib/costs/usage-view";
import { CostSectionTable } from "./cost-section-table";
import { CostUsageChart } from "./cost-usage-chart";
import { CostAuditCharts } from "./cost-audit-charts";
import { CostSourceAudit } from "./cost-source-audit";

export function CostUsagePanel({
  sections,
  isOwner,
  cursorAudit,
  billing,
  costDetailsAvailable = true,
}: {
  isOwner: boolean;
  cursorAudit?: CursorAuditDto;
  billing?: CostBillingDisplay;
  costDetailsAvailable?: boolean;
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
    () => buildCostUsageModel({ lines: allLines, range, billing }),
    [allLines, range, billing],
  );
  const visibleSections = sections
    .map((section) => {
      const sectionLineIds = new Set(section.lines.map((line) => line.id));
      return {
        ...section,
        rawLines: model.filteredLines.filter((line) => sectionLineIds.has(line.id)),
      };
    })
    .filter((section) => section.rawLines.length > 0)
    .map((section) => ({
      ...section,
      summaryLines: summarizeCostLines(section.rawLines),
      amountLabel: formatMarkedGbp(
        section.rawLines.reduce((total, line) => total + line.amountMinor, 0),
      ),
    }));
  const audit = buildCostAuditView(model);

  return (
    <div className="mb-8 space-y-8">
      <section className="space-y-7 rounded-xl border border-border bg-surface p-4 shadow-low sm:p-7">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Usage</h2>
            <p className="mt-1 text-sm text-text-secondary">{model.rangeLabel} · GBP · service dates in UTC</p>
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

        {costDetailsAvailable ? <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border py-6 lg:grid-cols-4">
          <SummaryCard title="Net client charges" value={formatMarkedGbp(audit.netTotal)} />
          <SummaryCard title="Development" value={formatMarkedGbp(model.series.find(item => item.key === "Development (Cursor)")?.amountMinor ?? 0)} />
          <SummaryCard title="Other categories, net" value={formatMarkedGbp(model.series.filter(item => item.key !== "Development (Cursor)").reduce((sum, item) => sum + item.amountMinor, 0))} />
          <SummaryCard title="Provisional portion" value={formatMarkedGbp(audit.provisionalTotal)} />
        </div> : null}

        <div>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">How costs built up</h3>
              <p className="text-sm text-text-secondary">
                {model.billingApplied
                  ? "Cumulative charges above zero, credits below. The dashed line is invoiced and the white line is the net total remaining to invoice."
                  : "Cumulative charges above zero, credits below, and net total as a line."}
              </p>
            </div>
            <p className="text-xs text-text-secondary">Grouped by category</p>
          </div>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Cumulative costs chart, scroll horizontally on small screens">
            <div className="min-w-[560px]">
              <CostUsageChart
                points={model.points}
                seriesKeys={model.chartSeriesKeys}
                billingApplied={model.billingApplied}
                invoicesAvailable={model.invoicesAvailable}
              />
            </div>
          </div>
          {model.chartSeriesKeys.length > 0 || model.billingApplied ? (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-secondary">
              {model.chartSeriesKeys.map((key, index) => (
                <li key={key} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: costSeriesColor(key, index) }}
                    aria-hidden
                  />
                  {key}
                </li>
              ))}
              {model.invoicesAvailable && model.points.some((point) => typeof point.invoicedPence === "number") ? (
                <li className="flex items-center gap-2">
                  <span
                    className="h-0 w-4 border-t-2 border-dashed border-[#E4E4E7]"
                    aria-hidden
                  />
                  Invoiced
                </li>
              ) : null}
              {(model.billingApplied
                ? model.points.some((point) => typeof point.remainingToInvoicePence === "number")
                : model.chartSeriesKeys.length > 0) ? (
                <li className="flex items-center gap-2">
                  <span
                    className="h-0 w-4 border-t-2 border-text-primary"
                    aria-hidden
                  />
                  {model.billingApplied ? "Net total · remaining to invoice" : "Net total"}
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
        {costDetailsAvailable
          ? <CostAuditCharts model={model} />
          : <p className="text-sm text-text-secondary">Usage detail is unavailable.</p>}
      </section>

      {isOwner && cursorAudit ? <CostSourceAudit key={range} audit={{ ...cursorAudit,
        rows: cursorAudit.rows.filter(row => (!model.fromDay || row.day >= model.fromDay) && (!model.toDay || row.day <= model.toDay)),
      }} /> : null}

      {visibleSections.map((section) => (
        <CostSectionTable
          key={`${section.key}:${range}`}
          label={section.label}
          amountLabel={section.amountLabel}
          rawLines={section.rawLines}
          summaryLines={section.summaryLines}
          isOwner={isOwner}
        />
      ))}
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums text-text-primary">{value}</p>
      <p className="mt-1 text-xs leading-5 text-text-secondary">{title}</p>
    </div>
  );
}
