export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { AdminColumnMenu, AdminColumnVisibility } from "@/components/admin/admin-column-visibility";
import { AdminDataCell } from "@/components/admin/admin-data-cell";
import { AdminTableOptions } from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPager } from "@/components/admin/admin-pager";
import { AdminTableHeaderCell } from "@/components/admin/admin-sortable-head";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminDateCellClass,
} from "@/components/admin/admin-table";
import { formatAdminDate } from "@/lib/admin/format";
import { adminTotalPages, parseAdminPage } from "@/lib/admin/query";
import {
  CANCELLATION_TABLE_COLUMNS,
  CANCELLATION_TABLE_SORT,
} from "@/lib/admin/table-columns";
import { cancellationOrderBy } from "@/lib/admin/table-order";
import {
  ADMIN_TABLE_PAGE_SIZE,
  buildAdminListHref,
  parseAdminSort,
} from "@/lib/admin/table-state";
import { CancellationActions } from "./cancellation-actions";
import { getSampleVisibility } from "@/lib/listings/sample-visibility";
import { applySampleCancellationVisibility } from "@/lib/listings/sample-related-visibility";

export const metadata: Metadata = { title: "Cancellation Requests" };

const STATUS_VARIANT: Record<
  string,
  "warning" | "info" | "success" | "error" | "neutral"
> = {
  REQUESTED: "warning",
  ACKNOWLEDGED: "info",
  RECONCILED: "info",
  COMPLETED: "success",
  REJECTED: "error",
};

export default async function AdminCancellationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const page = parseAdminPage(params.page);
  const sort = parseAdminSort(params, CANCELLATION_TABLE_COLUMNS, CANCELLATION_TABLE_SORT);
  const where = applySampleCancellationVisibility(
    {},
    await getSampleVisibility(),
  );
  const [requests, total] = await Promise.all([
    db.dealerCancellationRequest.findMany({
      where,
      orderBy: cancellationOrderBy(sort),
      skip: (page - 1) * ADMIN_TABLE_PAGE_SIZE,
      take: ADMIN_TABLE_PAGE_SIZE,
      include: {
        dealer: { select: { name: true, slug: true } },
        subscription: {
          select: {
            status: true,
            cancelAtPeriodEnd: true,
            currentPeriodEnd: true,
            providerLifecycle: true,
          },
        },
      },
    }),
    db.dealerCancellationRequest.count({ where }),
  ]);
  const totalPages = adminTotalPages(total, ADMIN_TABLE_PAGE_SIZE);
  const current = {
    page: String(page),
    sort: sort.explicit ? sort.column : undefined,
    dir: sort.explicit ? sort.direction : undefined,
  };

  return (
    <>
      <AdminPageHeader
        title="Dealer cancellation requests"
        description="Acknowledge means staff have started or verified the Ripple change; it is not an in-app provider cancellation. Completion still requires provider cancellation and an expired paid period."
        meta={
          <>
            <span>{total} {total === 1 ? "request" : "requests"}</span>
            <Link href="/refunds" className="text-text-trust hover:underline">
              Refund Policy
            </Link>
          </>
        }
      />

      <AdminColumnVisibility tableId="cancellations" columns={CANCELLATION_TABLE_COLUMNS}>
      <AdminTableOptions count={`${total} ${total === 1 ? "request" : "requests"}`}>
        <AdminColumnMenu />
      </AdminTableOptions>
      <AdminTable minWidth="wide">
        <TableHeader>
          <TableRow>
            {CANCELLATION_TABLE_COLUMNS.map((column) => (
              <AdminTableHeaderCell
                key={column.id}
                column={column}
                sort={sort}
                pathname="/admin/cancellations"
                current={current}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((request) => (
            <TableRow key={request.id}>
              <TableCell data-column="dealer">
                <AdminDataCell
                  title={
                    <Link
                      href={`/dealers/${request.dealer.slug}`}
                      className="text-text-trust hover:underline"
                    >
                      {request.dealer.name}
                    </Link>
                  }
                  subtitle={request.dealer.slug}
                />
              </TableCell>
              <TableCell data-column="status">
                <Badge variant={STATUS_VARIANT[request.status] ?? "neutral"}>
                  {request.status}
                </Badge>
              </TableCell>
              <TableCell data-column="period" className={adminDateCellClass}>
                {formatAdminDate(request.periodEndAt)}
              </TableCell>
              <TableCell data-column="provider" className="text-xs text-text-secondary">
                {request.subscription.status}
                {request.subscription.cancelAtPeriodEnd ? " · period-end" : ""}
              </TableCell>
              <TableCell data-column="requested" className={adminDateCellClass}>
                {formatAdminDate(request.requestedAt)}
              </TableCell>
              <TableCell data-column="processed" className={adminDateCellClass}>
                {formatAdminDate(request.processedAt)}
              </TableCell>
              <TableCell data-column="actions" className={`${adminActionsCellClass} min-w-[220px]`}>
                <CancellationActions
                  requestId={request.id}
                  status={request.status}
                />
              </TableCell>
            </TableRow>
          ))}
          {requests.length === 0 ? (
            <TableRow>
              <AdminTableEmpty colSpan={CANCELLATION_TABLE_COLUMNS.length}>
                No dealer cancellation requests found.
              </AdminTableEmpty>
            </TableRow>
          ) : null}
        </TableBody>
      </AdminTable>
      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) =>
          buildAdminListHref("/admin/cancellations", current, { page: String(nextPage) })
        }
      />
      </AdminColumnVisibility>
    </>
  );
}
