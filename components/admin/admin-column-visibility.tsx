"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  const frame = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 980));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const preferenceKey = compact ? `${tableId}-compact` : tableId;
  const defaults = useMemo(() => compact
    ? columns.map(column => ["category", "region", "created", "updated", "expires", "reports", "joined", "phone"].includes(column.id)
      ? { ...column, defaultVisible: false } : column)
    : columns, [columns, compact]);
  const [hidden, setHidden] = useState(() => defaultHiddenColumnIds(columns));
  useEffect(() => {
    setHidden(readStoredHidden(preferenceKey, defaults));
  }, [preferenceKey, defaults]);

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
        writeStoredHidden(preferenceKey, next);
        return next;
      });
    },
    reset: () => {
      removeStoredHidden(preferenceKey);
      setHidden(defaultHiddenColumnIds(defaults));
    },
  }), [columns, hidden, preferenceKey, defaults]);

  return (
    <ColumnVisibilityContext.Provider value={value}>
      <div
        ref={frame}
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
