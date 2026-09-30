import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import {
  adminSortHref,
  type AdminColumn,
  type AdminSortState,
} from "@/lib/admin/table-state";
import { cn } from "@/lib/cn";

export function AdminTableHeaderCell({
  column,
  sort,
  pathname,
  current,
  resetPage = true,
}: {
  column: AdminColumn;
  sort: AdminSortState;
  pathname: string;
  current: Record<string, string | undefined>;
  resetPage?: boolean;
}) {
  const className = cn(column.align === "end" && "text-right", column.headerClassName);
  if (!column.defaultDirection) {
    return (
      <TableHead scope="col" data-column={column.id} className={className}>
        {column.label}
      </TableHead>
    );
  }

  const active = sort.column === column.id;
  const href = adminSortHref({
    pathname,
    current,
    sort,
    column,
    resetPage,
  });

  return (
    <TableHead
      scope="col"
      data-column={column.id}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={className}
    >
      <Link
        href={href}
        className={cn(
          "inline-flex min-h-9 items-center gap-1 rounded-sm text-inherit",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500",
          column.align === "end" && "w-full justify-end",
          active ? "text-text-primary" : "hover:text-text-primary",
        )}
      >
        {column.label}
        {active ? (
          sort.direction === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          )
        ) : null}
      </Link>
    </TableHead>
  );
}
