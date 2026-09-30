export type AdminSortDirection = "asc" | "desc";

export interface AdminColumn {
  id: string;
  label: string;
  defaultDirection?: AdminSortDirection;
  pinned?: boolean;
  defaultVisible?: boolean;
  align?: "start" | "end";
  headerClassName?: string;
}

export interface AdminSortState {
  column: string;
  direction: AdminSortDirection;
  explicit: boolean;
}

export interface AdminSortFallback {
  column: string;
  direction: AdminSortDirection;
}

export const ADMIN_TABLE_PAGE_SIZE = 25;
export const ADMIN_COLUMN_STORAGE_VERSION = 1;

const COLUMN_ID_PATTERN = /^[a-z0-9-]+$/;

export function adminColumnStorageKey(tableId: string) {
  if (!COLUMN_ID_PATTERN.test(tableId)) {
    throw new Error("Admin table ids must be lowercase URL-safe tokens.");
  }
  return `iommarket.admin.columns.v${ADMIN_COLUMN_STORAGE_VERSION}:${tableId}`;
}

export function parseAdminEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function defaultHiddenColumnIds(columns: readonly AdminColumn[]) {
  return columns
    .filter((column) => !column.pinned && column.defaultVisible === false)
    .map((column) => column.id);
}

export function parseStoredColumnVisibility(
  raw: string | null,
  columns: readonly AdminColumn[],
) {
  const defaults = defaultHiddenColumnIds(columns);
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as { v?: unknown; hidden?: unknown };
    if (parsed.v !== ADMIN_COLUMN_STORAGE_VERSION || !Array.isArray(parsed.hidden)) {
      return defaults;
    }
    const hideable = new Set(
      columns.filter((column) => !column.pinned).map((column) => column.id),
    );
    return parsed.hidden.filter(
      (columnId): columnId is string =>
        typeof columnId === "string" && hideable.has(columnId),
    );
  } catch {
    return defaults;
  }
}

export function serializeColumnVisibility(hiddenIds: readonly string[]) {
  return JSON.stringify({
    v: ADMIN_COLUMN_STORAGE_VERSION,
    hidden: hiddenIds,
  });
}

export function parseAdminSort(
  params: { sort?: string; dir?: string },
  columns: readonly AdminColumn[],
  fallback: AdminSortFallback,
): AdminSortState {
  const sortable = new Map(
    columns
      .filter((column): column is AdminColumn & { defaultDirection: AdminSortDirection } =>
        column.defaultDirection !== undefined,
      )
      .map((column) => [column.id, column]),
  );
  const requested = sortable.get(params.sort?.trim() ?? "");
  if (!requested) {
    return {
      column: fallback.column,
      direction: fallback.direction,
      explicit: false,
    };
  }

  const direction = params.dir === "asc" || params.dir === "desc"
    ? params.dir
    : requested.defaultDirection;
  return {
    column: requested.id,
    direction,
    explicit: true,
  };
}

export function buildAdminListHref(
  pathname: string,
  current: Record<string, string | undefined>,
  overrides: Record<string, string | undefined> = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...overrides })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function adminSortHref(input: {
  pathname: string;
  current: Record<string, string | undefined>;
  sort: AdminSortState;
  column: AdminColumn;
  resetPage?: boolean;
}) {
  if (!input.column.defaultDirection) {
    throw new Error(`Column ${input.column.id} cannot be sorted.`);
  }

  const direction = input.sort.column === input.column.id
    ? input.sort.direction === "asc" ? "desc" : "asc"
    : input.column.defaultDirection;

  return buildAdminListHref(input.pathname, input.current, {
    sort: input.column.id,
    dir: direction,
    ...(input.resetPage === false ? {} : { page: "1" }),
  });
}

export function columnHideCss(tableId: string, columns: readonly AdminColumn[]) {
  if (!COLUMN_ID_PATTERN.test(tableId)) return "";
  return columns
    .filter((column) => COLUMN_ID_PATTERN.test(column.id))
    .map(
      (column) =>
        `[data-admin-table="${tableId}"][data-hidden~="${column.id}"] [data-column="${column.id}"]{display:none}`,
    )
    .join("");
}
