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
import type { CostLineDto } from "@/lib/costs/dto";
import { COST_USAGE_PAGE_SIZE, paginateCostLines } from "@/lib/costs/usage-view";

export function CostSectionTable({
  label,
  amountLabel,
  lines,
}: {
  label: string;
  amountLabel: string;
  lines: CostLineDto[];
}) {
  const [page, setPage] = useState(1);
  const paged = useMemo(() => paginateCostLines(lines, page), [lines, page]);

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text-primary">{label}</h2>
        <p className="text-sm text-text-secondary">{amountLabel}</p>
      </div>
      <AdminTable>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Item</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paged.pageLines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className={adminDateCellClass}>
                {new Date(line.periodStart).toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell>{line.label}</TableCell>
              <TableCell className={adminNumericCellClass}>{line.amountLabel}</TableCell>
              <TableCell>
                <Badge variant={line.provisional ? "warning" : "neutral"}>
                  {line.provisional ? "Provisional" : "Invoiceable"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </AdminTable>
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
