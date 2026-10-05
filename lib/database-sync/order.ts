export type CloneForeignKey = {
  name: string;
  child: string;
  parent: string;
  childColumns: string[];
  nullable: boolean;
  /** MATCH SIMPLE columns that can be cleared and restored without dropping the key. */
  nullableColumns?: string[];
  deferrable: boolean;
};

export type CloneOrder = {
  insertOrder: string[];
  deleteOrder: string[];
  deferredConstraints: string[];
  nullThenUpdate: Array<{ table: string; columns: string[] }>;
  blockers: string[];
};

function cycle(tables: string[], keys: CloneForeignKey[]): string[] | null {
  const edges = new Map(tables.map((table) => [table, [] as string[]]));
  for (const key of keys) edges.get(key.parent)?.push(key.child);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const found: string[] = [];
  const visit = (table: string): boolean => {
    if (visited.has(table)) return false;
    if (visiting.has(table)) {
      found.push(...stack.slice(stack.indexOf(table)), table);
      return true;
    }
    visiting.add(table);
    stack.push(table);
    for (const next of edges.get(table) ?? []) if (visit(next)) return true;
    stack.pop();
    visiting.delete(table);
    visited.add(table);
    return false;
  };
  for (const table of tables) if (visit(table)) return found;
  return null;
}

function topological(tables: string[], keys: CloneForeignKey[]): string[] | null {
  const incoming = new Map(tables.map((table) => [table, 0]));
  const children = new Map(tables.map((table) => [table, [] as string[]]));
  for (const key of keys) {
    if (!incoming.has(key.parent) || !incoming.has(key.child) || key.parent === key.child) continue;
    incoming.set(key.child, (incoming.get(key.child) ?? 0) + 1);
    children.get(key.parent)?.push(key.child);
  }
  const ready = tables.filter((table) => incoming.get(table) === 0);
  const ordered: string[] = [];
  while (ready.length) {
    const table = ready.shift()!;
    ordered.push(table);
    for (const child of children.get(table) ?? []) {
      incoming.set(child, (incoming.get(child) ?? 1) - 1);
      if (incoming.get(child) === 0) ready.push(child);
    }
  }
  return ordered.length === tables.length ? ordered : null;
}

export function planCloneOrder(tables: string[], foreignKeys: readonly CloneForeignKey[]): CloneOrder {
  const blockers: string[] = [];
  const deferred = new Set<string>();
  const nullable = new Map<string, Set<string>>();
  const breakableColumns = (key: CloneForeignKey) => key.nullableColumns?.length ? key.nullableColumns : key.childColumns;
  const rememberNull = (table: string, columns: string[]) => {
    const current = nullable.get(table) ?? new Set<string>();
    for (const column of columns) current.add(column);
    nullable.set(table, current);
  };
  const active = foreignKeys.filter((key) => tables.includes(key.child) && tables.includes(key.parent) && key.child !== key.parent);
  for (const key of foreignKeys) {
    if (key.child !== key.parent || !tables.includes(key.child)) continue;
    if (key.deferrable) deferred.add(key.name);
    else if (key.nullable) rememberNull(key.child, breakableColumns(key));
    else blockers.push(`Cannot order ${key.child}: required self-reference ${key.name} is not deferrable.`);
  }
  for (let guard = 0; guard <= foreignKeys.length; guard += 1) {
    const found = cycle(tables, active);
    if (!found) break;
    const index = active.findIndex((key) => found.includes(key.child) && found.includes(key.parent) && (key.nullable || key.deferrable));
    if (index < 0) {
      blockers.push(`Cannot order a required foreign-key cycle: ${found.join(" -> ")}.`);
      break;
    }
    const [key] = active.splice(index, 1);
    if (key.deferrable) deferred.add(key.name);
    if (key.nullable) rememberNull(key.child, breakableColumns(key));
  }
  const insertOrder = topological(tables, active);
  if (!insertOrder) blockers.push("Foreign-key order could not be resolved.");
  const ordered = insertOrder ?? [...tables];
  return {
    insertOrder: ordered,
    deleteOrder: [...ordered].reverse(),
    deferredConstraints: [...deferred],
    nullThenUpdate: [...nullable].map(([table, columns]) => ({ table, columns: [...columns] })),
    blockers,
  };
}
