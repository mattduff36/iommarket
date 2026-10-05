import type { PoolClient } from "pg";

export type PhysicalColumn = {
  name: string;
  dataType: string;
  generated: boolean;
  identity: "" | "a" | "d";
};

export async function loadPhysicalColumns(client: PoolClient, schema: string, table: string): Promise<PhysicalColumn[]> {
  const result = await client.query<{ name: string; data_type: string; generated: string; identity: string }>(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS data_type,
            a.attgenerated AS generated, a.attidentity AS identity
     FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
    [schema, table],
  );
  return result.rows.map((row) => ({
    name: row.name,
    dataType: row.data_type,
    generated: row.generated === "s" || row.generated === "v",
    identity: row.identity === "a" || row.identity === "d" ? row.identity : "",
  }));
}
