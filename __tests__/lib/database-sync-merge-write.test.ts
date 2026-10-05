import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneInsertSql, type CloneWriteColumn } from "@/lib/database-sync/merge-write";

// Only a disposable localhost database. No application configuration or hosted credentials.
const bin = "C:/Program Files/PostgreSQL/18/bin";
const port = 55438;
const available = existsSync(join(bin, "initdb.exe"));
let directory: string;
let client: Client | undefined;
let started = false;
const columns: CloneWriteColumn[] = [
  { name: "id", type: "text", index: 0, identity: "" },
  { name: "amount", type: "numeric", index: 1, identity: "" },
  { name: "payload", type: "jsonb", index: 2, identity: "" },
  { name: "note", type: "text", index: 3, identity: "" },
];
const sql = cloneInsertSql({ schema: "public", name: "ImmutableProbe", primaryKey: "id" }, columns, "merge");
function run(name: string, args: string[]) {
  execFileSync(join(bin, `${name}.exe`), args, { stdio: "ignore", timeout: 60000, windowsHide: true });
}

describe.skipIf(!available)("unchanged-row merge against an actual append-only trigger", () => {
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "itrader-apply-feedback-"));
    const data = join(directory, "data");
    run("initdb", ["-D", data, "--username=fixture_root", "--auth=trust", "--encoding=UTF8", "--locale=C", "--no-sync"]);
    run("pg_ctl", ["-D", data, "-l", join(directory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
    started = true;
    client = new Client({ host: "127.0.0.1", port, user: "fixture_root", database: "postgres", ssl: false });
    await client.connect();
    await client.query(`CREATE TABLE public."ImmutableProbe" (id text PRIMARY KEY, amount numeric, payload jsonb, note text);
      CREATE FUNCTION public.reject_probe_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'cost ledger rows are append-only'; END; $$;
      CREATE TRIGGER immutable_probe BEFORE UPDATE OR DELETE ON public."ImmutableProbe" FOR EACH ROW EXECUTE FUNCTION public.reject_probe_update();
      INSERT INTO public."ImmutableProbe" VALUES ('existing',1.00,'{"a":1,"b":2}',NULL);`);
  }, 120000);

  afterAll(async () => {
    await client?.end();
    if (started) run("pg_ctl", ["-D", join(directory, "data"), "-m", "fast", "-w", "stop"]);
    if (directory) rmSync(directory, { recursive: true, force: true });
  }, 30000);

  it("reproduces the old upsert failure without weakening the immutable trigger", async () => {
    const oldSql = sql.slice(0, sql.lastIndexOf(" WHERE "));
    await expect(client!.query(oldSql, [JSON.stringify([["existing", "1", '{"a":1,"b":2}', null]])])).rejects.toMatchObject({ code: "P0001" });
  });

  it("skips the identical typed row while inserting a missing row", async () => {
    const result = await client!.query(sql, [JSON.stringify([
      ["existing", "1.000", '{"b":2,"a":1}', null],
      ["new", "2", '{"a":2}', "new record"],
    ])]);
    expect(result.rowCount).toBe(1);
    expect((await client!.query('SELECT count(*)::int AS count FROM public."ImmutableProbe"')).rows[0].count).toBe(2);
  });

  it("still refuses a genuine change to the immutable row", async () => {
    await expect(client!.query(sql, [JSON.stringify([["existing", "999", '{"a":1,"b":2}', null]])])).rejects.toMatchObject({ code: "P0001" });
    expect((await client!.query('SELECT amount::text AS amount FROM public."ImmutableProbe" WHERE id=$1', ["existing"])).rows[0].amount).toBe("1.00");
  });
});
