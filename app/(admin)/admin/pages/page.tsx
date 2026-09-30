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
import { AdminFilterBar, AdminFilterChip } from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminTableHeaderCell } from "@/components/admin/admin-sortable-head";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminDateCellClass,
} from "@/components/admin/admin-table";
import { formatAdminDate } from "@/lib/admin/format";
import { PAGE_TABLE_COLUMNS, PAGE_TABLE_SORT } from "@/lib/admin/table-columns";
import { contentPageOrderBy } from "@/lib/admin/table-order";
import { buildAdminListHref, parseAdminSort } from "@/lib/admin/table-state";
import { RestorePageButton } from "./restore-page-button";

export const metadata: Metadata = { title: "Content Pages | Admin" };

export default async function AdminPagesListPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const showDeleted = params.deleted === "1";
  const sort = parseAdminSort(params, PAGE_TABLE_COLUMNS, PAGE_TABLE_SORT);
  const pages = await db.contentPage.findMany({
    where: { deletedAt: showDeleted ? { not: null } : null },
    orderBy: contentPageOrderBy(sort),
  });
  const current = {
    deleted: showDeleted ? "1" : undefined,
    sort: sort.explicit ? sort.column : undefined,
    dir: sort.explicit ? sort.direction : undefined,
  };

  return (
    <AdminColumnVisibility tableId="pages" columns={PAGE_TABLE_COLUMNS}>
      <AdminPageHeader
        title="Content pages"
        description="Create and maintain the editable pages published across the marketplace."
        actions={
          <Link
            href="/admin/pages/new"
            className="inline-flex h-8 items-center justify-center rounded-md border border-neon-blue-500/25 bg-neon-blue-500/10 px-3 text-xs font-medium text-neon-blue-400 transition-colors hover:border-neon-blue-500/45 hover:bg-neon-blue-500/15 hover:text-neon-blue-500"
          >
            New Page
          </Link>
        }
      />

      <AdminFilterBar
        count={`${pages.length} ${pages.length === 1 ? "page" : "pages"}`}
        tools={<AdminColumnMenu />}
      >
        <AdminFilterChip
          href={buildAdminListHref("/admin/pages", current, {
            deleted: showDeleted ? undefined : "1",
          })}
          active={showDeleted}
          activeTone="warning"
        >
          Deleted pages
        </AdminFilterChip>
      </AdminFilterBar>

      <AdminTable>
        <TableHeader>
          <TableRow>
            {PAGE_TABLE_COLUMNS.map((column) => (
              <AdminTableHeaderCell
                key={column.id}
                column={column}
                sort={sort}
                pathname="/admin/pages"
                current={current}
                resetPage={false}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pages.map((page) => (
            <TableRow key={page.id}>
              <TableCell data-column="title" className="font-medium text-text-primary">{page.title}</TableCell>
              <TableCell data-column="slug" className="font-mono text-sm text-text-tertiary">/{page.slug}</TableCell>
              <TableCell data-column="status">
                <Badge variant={page.status === "PUBLISHED" ? "success" : "neutral"}>
                  {page.status}
                </Badge>
              </TableCell>
              <TableCell data-column="updated" className={adminDateCellClass}>
                {formatAdminDate(page.updatedAt)}
              </TableCell>
              <TableCell data-column="created" className={adminDateCellClass}>
                {formatAdminDate(page.createdAt)}
              </TableCell>
              <TableCell data-column="published" className={adminDateCellClass}>
                {formatAdminDate(page.publishedAt)}
              </TableCell>
              <TableCell data-column="actions" className={adminActionsCellClass}>
                {page.deletedAt ? (
                  <RestorePageButton id={page.id} />
                ) : (
                  <Link
                    href={`/admin/pages/${page.id}`}
                    className="text-sm text-neon-blue-400 hover:underline"
                  >
                    Edit
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
          {pages.length === 0 && (
            <TableRow>
              <AdminTableEmpty colSpan={PAGE_TABLE_COLUMNS.length}>
                {showDeleted
                  ? "No deleted content pages."
                  : "No content pages yet. Create one to get started."}
              </AdminTableEmpty>
            </TableRow>
          )}
        </TableBody>
      </AdminTable>
    </AdminColumnVisibility>
  );
}
