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
  cards: boolean;
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

function textLineCount(cell: HTMLElement) {
  const nodes = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  if (typeof range.getClientRects !== "function") return 0;
  const lines = new Set<number>();
  while (nodes.nextNode()) {
    if (!nodes.currentNode.textContent?.trim()) continue;
    range.selectNodeContents(nodes.currentNode);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width && rect.height) lines.add(Math.round(rect.bottom));
    }
  }
  return lines.size;
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
  const [cards, setCards] = useState(false);
  const [autoHidden, setAutoHidden] = useState<string[]>([]);
  const [keepVisible, setKeepVisible] = useState<string[]>([]);
  const preferenceKey = compact ? `${tableId}-compact` : tableId;
  const defaults = columns;
  const [hidden, setHidden] = useState(() => defaultHiddenColumnIds(columns));
  useEffect(() => {
    setHidden(readStoredHidden(preferenceKey, defaults));
  }, [preferenceKey, defaults]);

  useEffect(() => {
    setKeepVisible(readStoredHidden(preferenceKey + "-shown", columns.map(column => ({ ...column, defaultVisible: true }))));
  }, [columns, preferenceKey]);

  useEffect(() => {
    const root = frame.current;
    const container = root?.querySelector<HTMLElement>(".responsive-table-frame");
    if (!root || !container || typeof ResizeObserver === "undefined") return;
    let animation = 0;
    const fit = () => {
      const table = container.querySelector("table");
      if (!table) return;
      const cardLayout = getComputedStyle(table).display === "block";
      setCards(cardLayout);
      setCompact(container.clientWidth < 980);
      const removed: string[] = [];
      // Restore the full candidate layout first so growing the frame restores columns.
      root.dataset.fitHidden = "";
      if (!cardLayout) {
        const candidates = ["updated", "created", "joined", "expires", "phone", "reports", "region", "category"]
          .filter(id => !hidden.includes(id) && !keepVisible.includes(id) && columns.some(c => c.id === id && !c.pinned));
        while (candidates.length) {
          let worst = -1;
          let mostLines = 2;
          candidates.forEach((id, index) => {
            const cells = table.querySelectorAll<HTMLElement>(`tbody [data-column="${id}"]`);
            for (const cell of Array.from(cells)) {
              const lines = textLineCount(cell);
              if (lines > mostLines) {
                mostLines = lines;
                worst = index;
              }
            }
          });
          if (worst < 0) break;
          removed.push(...candidates.splice(worst, 1));
          // The next column is measured after the browser redistributes this one's width.
          root.dataset.fitHidden = removed.join(" ");
        }
      }
      setAutoHidden(previous => previous.join(" ") === removed.join(" ") ? previous : removed);
    };
    const schedule = () => { cancelAnimationFrame(animation); animation = requestAnimationFrame(fit); };
    const resize = new ResizeObserver(schedule);
    resize.observe(container);
    const changes = new MutationObserver(schedule);
    changes.observe(container, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-ready"] });
    document.fonts?.addEventListener("loadingdone", schedule);
    schedule();
    return () => {
      resize.disconnect();
      changes.disconnect();
      document.fonts?.removeEventListener("loadingdone", schedule);
      cancelAnimationFrame(animation);
    };
  }, [columns, hidden, keepVisible, children]);

  const value = useMemo<ColumnVisibilityContextValue>(() => ({
    columns,
    hidden: [...hidden, ...autoHidden],
    cards,
    toggle: (columnId: string) => {
      const column = columns.find((item) => item.id === columnId);
      if (!column || column.pinned) return;
      const show = hidden.includes(columnId) || autoHidden.includes(columnId);
      const shown = keepVisible.filter(id => id !== columnId);
      if (show) shown.push(columnId);
      setKeepVisible(shown);
      writeStoredHidden(preferenceKey + "-shown", shown);
      setHidden((current) => {
        const next = show
          ? current.filter((id) => id !== columnId)
          : [...current, columnId];
        writeStoredHidden(preferenceKey, next);
        return next;
      });
    },
    reset: () => {
      removeStoredHidden(preferenceKey);
      removeStoredHidden(preferenceKey + "-shown");
      setKeepVisible([]);
      setHidden(defaultHiddenColumnIds(defaults));
    },
  }), [columns, hidden, preferenceKey, defaults, autoHidden, cards, keepVisible]);

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

  if (context.cards) return null;
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
