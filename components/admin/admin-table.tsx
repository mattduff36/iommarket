import type { HTMLAttributes, ReactNode } from "react";
import { Table, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/cn";

interface AdminTableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
  minWidth?: "standard" | "wide";
}

export function AdminTable({
  children,
  className,
  minWidth: _minWidth,
  ...props
}: AdminTableProps) {
  return (
    <Table
      className={cn(
        "[&_th]:h-9 [&_th]:px-3 [&_th]:text-[11px] [&_th]:tracking-wide",
        "[&_td]:px-3 [&_td]:py-2.5 [&_tbody_tr]:focus-within:bg-surface-elevated",
        className,
      )}
      {...props}
    >
      {children}
    </Table>
  );
}

export function AdminTableEmpty({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <TableCell
      colSpan={colSpan}
      className="h-32 text-center text-sm text-text-tertiary"
    >
      {children}
    </TableCell>
  );
}

export const adminNumericCellClass =
  "text-right font-medium tabular-nums text-text-secondary";

export const adminDateCellClass =
  "whitespace-nowrap text-xs tabular-nums text-text-tertiary";

export const adminActionsCellClass = "w-[1%] whitespace-nowrap text-right";
