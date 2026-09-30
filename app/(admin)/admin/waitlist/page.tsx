export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminDataCell } from "@/components/admin/admin-data-cell";
import {
  AdminFilterBar,
  AdminFilterChip,
  adminSearchButtonClass,
  adminSearchInputClass,
} from "@/components/admin/admin-filter-bar";
import { AdminColumnMenu, AdminColumnVisibility } from "@/components/admin/admin-column-visibility";
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
import { WAITLIST_TABLE_COLUMNS, WAITLIST_TABLE_SORT } from "@/lib/admin/table-columns";
import { waitlistOrderBy } from "@/lib/admin/table-order";
import {
  ADMIN_TABLE_PAGE_SIZE,
  buildAdminListHref,
  parseAdminSort,
} from "@/lib/admin/table-state";
import { WaitlistRowActions } from "./waitlist-row-actions";

export const metadata: Metadata = { title: "Waitlist | Admin" };

interface Props {
  searchParams: Promise<{
    q?: string;
    deleted?: string;
    page?: string;
    sort?: string;
    dir?: string;
  }>;
}

function parseInterests(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function formatInterestLabel(interest: string): string {
  switch (interest) {
    case "BUYING_CARS":
      return "Buying cars";
    case "SELLING_CARS":
      return "Selling cars";
    case "DEALER":
      return "Dealer";
    default:
      return interest;
  }
}

export default async function AdminWaitlistPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const showDeleted = params.deleted === "1";
  const page = parseAdminPage(params.page);
  const sort = parseAdminSort(params, WAITLIST_TABLE_COLUMNS, WAITLIST_TABLE_SORT);

  const where = {
    deletedAt: showDeleted ? { not: null } : null,
    ...(query
      ? {
          email: {
            contains: query,
            mode: "insensitive" as const,
          },
        }
      : {}),
  };

  const [waitlistUsers, total] = await Promise.all([
    db.waitlistUser.findMany({
      where,
      orderBy: waitlistOrderBy(sort),
      skip: (page - 1) * ADMIN_TABLE_PAGE_SIZE,
      take: ADMIN_TABLE_PAGE_SIZE,
      select: {
        id: true,
        email: true,
        interests: true,
        source: true,
        createdAt: true,
        marketingConsentAt: true,
        deletedAt: true,
      },
    }),
    db.waitlistUser.count({ where }),
  ]);
  const totalPages = adminTotalPages(total, ADMIN_TABLE_PAGE_SIZE);
  const current = {
    q: query || undefined,
    deleted: showDeleted ? "1" : undefined,
    page: String(page),
    sort: sort.explicit ? sort.column : undefined,
    dir: sort.explicit ? sort.direction : undefined,
  };

  function buildUrl(overrides: Record<string, string | undefined>) {
    return buildAdminListHref("/admin/waitlist", current, overrides);
  }

  return (
    <AdminColumnVisibility tableId="waitlist" columns={WAITLIST_TABLE_COLUMNS}>
      <AdminPageHeader
        title="Waitlist"
        description="Review pre-launch signups captured from the coming soon page."
        actions={
          <Link
            href="/api/admin/waitlist/export"
            className={adminSearchButtonClass}
          >
            Export CSV
          </Link>
        }
      />

      <AdminFilterBar
        count={`${total} ${total === 1 ? "entry" : "entries"}`}
        tools={<AdminColumnMenu />}
      >
        <form method="get" action="/admin/waitlist" className="flex min-w-0 gap-2">
          {current.sort ? <input type="hidden" name="sort" value={current.sort} /> : null}
          {current.dir ? <input type="hidden" name="dir" value={current.dir} /> : null}
          <input
            name="q"
            defaultValue={query}
            placeholder="Search by email..."
            aria-label="Search waitlist"
            className={adminSearchInputClass}
          />
          {showDeleted ? <input type="hidden" name="deleted" value="1" /> : null}
          <button type="submit" className={adminSearchButtonClass}>
            Search
          </button>
        </form>
        <AdminFilterChip
          href={buildUrl({ deleted: showDeleted ? undefined : "1", page: "1" })}
          active={showDeleted}
          activeTone="warning"
        >
          Deleted entries
        </AdminFilterChip>
      </AdminFilterBar>

      <AdminTable>
        <TableHeader>
          <TableRow>
            {WAITLIST_TABLE_COLUMNS.map((column) => (
              <AdminTableHeaderCell
                key={column.id}
                column={column}
                sort={sort}
                pathname="/admin/waitlist"
                current={current}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {waitlistUsers.map((user) => {
            const interests = parseInterests(user.interests).map(formatInterestLabel);
            return (
              <TableRow key={user.id}>
                <TableCell data-column="email">
                  <AdminDataCell title={user.email} />
                </TableCell>
                <TableCell data-column="interests" className="text-sm text-text-secondary">
                  {interests.length > 0 ? interests.join(", ") : "—"}
                </TableCell>
                <TableCell data-column="joined" className={adminDateCellClass}>
                  {formatAdminDate(user.createdAt)}
                </TableCell>
                <TableCell data-column="source" className="text-sm text-text-secondary">
                  {user.source}
                </TableCell>
                <TableCell data-column="consent" className={adminDateCellClass}>
                  {formatAdminDate(user.marketingConsentAt)}
                </TableCell>
                <TableCell data-column="deleted" className={adminDateCellClass}>
                  {formatAdminDate(user.deletedAt)}
                </TableCell>
                <TableCell data-column="actions" className={adminActionsCellClass}>
                  <WaitlistRowActions
                    id={user.id}
                    email={user.email}
                    deleted={Boolean(user.deletedAt)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
          {waitlistUsers.length === 0 && (
            <TableRow>
              <AdminTableEmpty colSpan={WAITLIST_TABLE_COLUMNS.length}>
                No waitlist entries match these filters.
              </AdminTableEmpty>
            </TableRow>
          )}
        </TableBody>
      </AdminTable>
      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) => buildUrl({ page: String(nextPage) })}
      />
    </AdminColumnVisibility>
  );
}
