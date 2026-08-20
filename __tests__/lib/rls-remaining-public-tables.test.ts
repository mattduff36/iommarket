import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ADVISOR_TABLES = [
  "AdminAuditLog",
  "ContentPage",
  "SiteSetting",
  "MonitoringIssue",
  "MonitoringIssueStatusEvent",
  "MonitoringEvent",
  "MonitoringAlertDelivery",
  "FreeListingClaim",
  "WaitlistUser",
  "DealerReview",
  "DealerReviewModerationEvent",
  "ListingImageUploadIntent",
  "ListingImageCleanupJob",
  "ListingStatusEvent",
] as const;

const MIGRATION_NAME = "20260820220000_enable_rls_remaining_public_tables";
const ENABLE_RLS =
  /ALTER TABLE\s+(?:public\.|"public"\.)"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ENABLE ROW LEVEL SECURITY/gi;
const DISABLE_RLS =
  /ALTER TABLE\s+(?:public\.|"public"\.)"?([A-Za-z_][A-Za-z0-9_]*)"?\s+DISABLE ROW LEVEL SECURITY/gi;
const ENABLE_STATEMENT =
  /^ALTER TABLE "public"\."([A-Za-z_][A-Za-z0-9_]*)" ENABLE ROW LEVEL SECURITY;$/;

function readMigration(name: string) {
  return readFileSync(
    resolve(process.cwd(), "prisma", "migrations", name, "migration.sql"),
    "utf8",
  );
}

function stripSqlComments(sql: string) {
  return sql
    .split("\n")
    .map((line) => {
      const commentIndex = line.indexOf("--");
      return commentIndex === -1 ? line : line.slice(0, commentIndex);
    })
    .join("\n");
}

function parsePrismaModels(schema: string) {
  if (/\b@@(?:map|schema)\b/.test(schema)) {
    throw new Error(
      "RLS-REG-001 cannot infer table names while @@map or @@schema is present",
    );
  }

  return [...schema.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)/gm)].map(
    (match) => match[1],
  );
}

function collectRlsHistory() {
  const migrationsDir = resolve(process.cwd(), "prisma", "migrations");
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const lastEnableByTable = new Map<string, string>();
  const lastDisableByTable = new Map<string, string>();

  for (const folder of folders) {
    const sql = readMigration(folder);
    for (const match of sql.matchAll(ENABLE_RLS)) {
      lastEnableByTable.set(match[1], folder);
    }
    for (const match of sql.matchAll(DISABLE_RLS)) {
      lastDisableByTable.set(match[1], folder);
    }
  }

  return { lastEnableByTable, lastDisableByTable };
}

describe("RLS-ADV-001 remaining public tables", () => {
  it("enables RLS on exactly the 14 advisor tables without other executable SQL", () => {
    const sql = readMigration(MIGRATION_NAME);
    const statements = stripSqlComments(sql)
      .split(";")
      .map((part) => `${part.trim()};`)
      .filter((part) => part !== ";");

    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bDROP\b/i);

    const enabled = statements.map((statement) => {
      const match = statement.match(ENABLE_STATEMENT);
      expect(match, `unexpected SQL: ${statement}`).not.toBeNull();
      return match![1];
    });

    expect(enabled).toEqual([...ADVISOR_TABLES]);
  });
});

describe("RLS-REG-001 public model coverage", () => {
  it("enables RLS for every Prisma model and never disables it later", () => {
    const schema = readFileSync(
      resolve(process.cwd(), "prisma", "schema.prisma"),
      "utf8",
    );
    const models = parsePrismaModels(schema);
    const { lastEnableByTable, lastDisableByTable } = collectRlsHistory();

    expect(models).toHaveLength(58);

    const missing = models.filter((model) => !lastEnableByTable.has(model));
    expect(missing).toEqual([]);

    const disabledAfterEnable = models.filter((model) => {
      const enabledAt = lastEnableByTable.get(model);
      const disabledAt = lastDisableByTable.get(model);
      return Boolean(enabledAt && disabledAt && disabledAt >= enabledAt);
    });
    expect(disabledAfterEnable).toEqual([]);
  });
});
