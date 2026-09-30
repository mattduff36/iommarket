"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { adminSearchButtonClass } from "@/components/admin/admin-filter-bar";
import {
  adminColumnStorageKey,
  columnHideCss,
  defaultHiddenColumnIds,
  parseStoredColumnVisibility,
  serializeColumnVisibility,
  type AdminColumn,
} from "@/lib/admin/table-state";

interface ColumnVisibilityContextValue {
  columns: readonly AdminColumn[];
  hidden: readonly string[];
  toggle: (columnId: string) => void;
  reset: () => void;
}

const ColumnVisibilityContext = createContext<ColumnVisibilityContextValue | null>(null);

function readStoredHidden(tableId: string, columns: readonly AdminColumn[]) {
  try {
    return parseStoredColumnVisibility(
      window.localStorage.getItem(adminColumnStorageKey(tableId)),
      columns,
    );
  } catch {
    return defaultHiddenColumnIds(columns);
  }
}

function writeStoredHidden(tableId: string, hidden: readonly string[]) {
  try {
    window.localStorage.setItem(
      adminColumnStorageKey(tableId),
      serializeColumnVisibility(hidden),
    );
  } catch {
    // Column preferences are convenience state; the table remains usable.
  }
}

function removeStoredHidden(tableId: string) {
  try {
    window.localStorage.removeItem(adminColumnStorageKey(tableId));
  } catch {
    // Ignore storage failures and fall back to the default columns.
  }
}

export function AdminColumnVisibility({
  tableId,
  columns,
  children,
}: {
  tableId: string;
  columns: readonly AdminColumn[];
  children: ReactNode;
}) {
  const [hidden, setHidden] = useState(() => defaultHiddenColumnIds(columns));

  useEffect(() => {
    setHidden(readStoredHidden(tableId, columns));
  }, [tableId, columns]);

  const value = useMemo<ColumnVisibilityContextValue>(() => ({
    columns,
    hidden,
    toggle: (columnId: string) => {
      const column = columns.find((item) => item.id === columnId);
      if (!column || column.pinned) return;
      setHidden((current) => {
        const next = current.includes(columnId)
          ? current.filter((id) => id !== columnId)
          : [...current, columnId];
        writeStoredHidden(tableId, next);
        return next;
      });
    },
    reset: () => {
      removeStoredHidden(tableId);
      setHidden(defaultHiddenColumnIds(columns));
    },
  }), [columns, hidden, tableId]);

  return (
    <ColumnVisibilityContext.Provider value={value}>
      <div
        data-admin-table={tableId}
        data-hidden={hidden.length > 0 ? hidden.join(" ") : undefined}
      >
        <style>{columnHideCss(tableId, columns)}</style>
        {children}
      </div>
    </ColumnVisibilityContext.Provider>
  );
}

export function AdminColumnMenu() {
  const context = useContext(ColumnVisibilityContext);
  if (!context) {
    throw new Error("AdminColumnMenu must be used within AdminColumnVisibility.");
  }

  const optionalColumns = context.columns.filter((column) => !column.pinned);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger type="button" className={adminSearchButtonClass}>
        Columns
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {optionalColumns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={!context.hidden.includes(column.id)}
            onCheckedChange={() => context.toggle(column.id)}
            onSelect={(event) => event.preventDefault()}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => context.reset()}>
          Reset columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
