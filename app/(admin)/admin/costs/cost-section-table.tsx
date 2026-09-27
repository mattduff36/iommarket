"use client";

import { useMemo, useState } from "react";
import {
  AdminTable,
  adminDateCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { COST_SECTION_HELP } from "@/lib/costs/copy";
import type { CostLineDto } from "@/lib/costs/dto";
import {
  COST_USAGE_PAGE_SIZE,
  paginateCostLines,
  type CostSummaryLine,
} from "@/lib/costs/usage-view";

function formatPeriod(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const inclusiveEnd = new Date(Math.max(startDate.getTime(), endDate.getTime() - 1));
  const format = (value: Date) =>
    value.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  if (startDate.toISOString().slice(0, 10) === inclusiveEnd.toISOString().slice(0, 10)) {
    return format(startDate);
  }
  return `${format(startDate)} – ${format(inclusiveEnd)}`;
}

export function CostSectionTable({
  label,
  amountLabel,
  rawLines,
  summaryLines,
  isOwner,
}: {
  label: string;
  amountLabel: string;
  rawLines: CostLineDto[];
  summaryLines: CostSummaryLine[];
  isOwner: boolean;
}) {
  const [page, setPage] = useState(1);
  const [showLedgerEntries, setShowLedgerEntries] = useState(false);
  const lines = showLedgerEntries ? rawLines : summaryLines;
  const paged = useMemo(() => paginateCostLines(lines, page), [lines, page]);
  const help = COST_SECTION_HELP[label];

  return (
    <section className="mb-8">
      <div className="mb-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text-primary">{label}</h2>
          <p className="text-sm text-text-secondary">{amountLabel}</p>
        </div>
        {help ? <p className="mt-1 text-sm text-text-secondary">{help}</p> : null}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-text-secondary">
            {showLedgerEntries
              ? `${rawLines.length.toLocaleString("en-GB")} ledger entries`
              : `${summaryLines.length.toLocaleString("en-GB")} cost items combined from ${rawLines.length.toLocaleString("en-GB")} ledger entries`}
          </p>
          {isOwner ? (
            <button
              type="button"
              className="text-xs font-medium text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
              onClick={() => {
                setShowLedgerEntries((current) => !current);
                setPage(1);
              }}
            >
              {showLedgerEntries ? "Show client summary" : "Show all ledger entries"}
            </button>
          ) : null}
        </div>
      </div>
      {lines.length > 0 ? (
        <AdminTable>
          <TableHeader>
            <TableRow>
              <TableHead>Billing period</TableHead>
              <TableHead>Cost item</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Billing status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.pageLines.map((line) => {
              const adjustment = showLedgerEntries && line.kind === "REVERSAL";
              return (
                <TableRow key={line.id}>
                  <TableCell className={adminDateCellClass}>
                    {formatPeriod(line.periodStart, line.periodEnd)}
                  </TableCell>
                  <TableCell>{line.label}</TableCell>
                  <TableCell className={adminNumericCellClass}>{line.amountLabel}</TableCell>
                  <TableCell>
                    <Badge variant={line.provisional ? "warning" : "neutral"}>
                      {adjustment
                        ? "Adjustment"
                        : line.provisional
                          ? "Provisional"
                          : "Invoiceable"}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </AdminTable>
      ) : (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-secondary">
          No individual cost item is £0.01 or more in this period.
        </p>
      )}
      {paged.totalPages > 1 ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="text-sm text-text-secondary">
            Showing {(paged.currentPage - 1) * COST_USAGE_PAGE_SIZE + 1}–
            {Math.min(paged.currentPage * COST_USAGE_PAGE_SIZE, lines.length)} of {lines.length}
          </p>
          <Pagination
            currentPage={paged.currentPage}
            totalPages={paged.totalPages}
            onPageChange={setPage}
          />
        </div>
      ) : null}
    </section>
  );
}
