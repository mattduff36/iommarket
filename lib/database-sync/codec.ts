import { createHash } from "node:crypto";

export function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function selectExpression(column: string, dataType: string): string {
  const quoted = quoteIdent(column);
  if (dataType === "bytea") return `encode(${quoted}, 'hex') AS ${quoted}`;
  return `${quoted}::text AS ${quoted}`;
}

export function restoreValueExpression(dataType: string, index: number): string {
  if (!/^[a-zA-Z0-9_ ,[\]".()]+$/.test(dataType)) throw new Error("Unsupported database column type.");
  const value = `elem->>${index}`;
  if (dataType === "bytea") return `CASE WHEN ${value} IS NULL THEN NULL ELSE decode(${value}, 'hex') END`;
  return `CAST(${value} AS ${dataType})`;
}

export function canonicalBytes(table: string, columns: Array<{ name: string; type: string }>, rows: Array<Array<string | null>>): Buffer {
  const lines = [table, JSON.stringify(columns), ...rows.map((row) => JSON.stringify(row))];
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

export function hashCanonical(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseCanonical(value: Buffer): { table: string; columns: Array<{ name: string; type: string }>; rows: Array<Array<string | null>> } {
  const [table = "", header = "[]", ...lines] = value.toString("utf8").trimEnd().split("\n");
  return {
    table,
    columns: JSON.parse(header) as Array<{ name: string; type: string }>,
    rows: lines.filter(Boolean).map((line) => JSON.parse(line) as Array<string | null>),
  };
}
