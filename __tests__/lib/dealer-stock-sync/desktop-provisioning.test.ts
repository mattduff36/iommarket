import { describe, expect, it } from "vitest";
import { parseSupabaseConnectionIdentity } from "@/lib/db/supabase-identity";
import { resolveDesktopGate } from "@/lib/dealer-stock-sync/desktop-config";
import { DPAPI_SCRIPTS } from "../../../scripts/stock-update-desktop/provision-state";
import {
  ADMIN_IDS,
  CANONICAL_ORIGIN,
  CHILD_ROLES,
  POOLER_HOST,
  PRODUCTION_SUPABASE_REF,
  PROVISION_SQL,
  STAGING_SUPABASE_REF,
  WORKER_ROLE,
  activationStatement,
  assertAdminDatabaseUrl,
  assertAliasUnchanged,
  assertChildRoles,
  assertConfiguredDatabaseProjects,
  assertDedicatedImageKit,
  assertEnvWrites,
  assertPins,
  assertQueueEmpty,
  assertRestrictedWorker,
  assertSmoke,
  verifyPermissionDenied,
  buildDesktopConfig,
  buildEnvWrites,
  buildGateEnv,
  buildProvisionState,
  buildSharedWorkerEnv,
  classifyProjectEnv,
  decideProvision,
  disableStatement,
  escapeLiteral,
  generateProvisioningPassword,
  parseProvisionMode,
  parseProvisionState,
  prepareDesktop,
  privateTreeIgnored,
  provisioningStatePath,
  readAliasSnapshot,
  vercelEnvCreateUrl,
  vercelEnvListUrl,
  ProvisionRefusal,
  type EnvClassification,
} from "@/lib/dealer-stock-sync/desktop-provisioning";

const CERT = "-----BEGIN CERTIFICATE-----\nMIIBTESTCERTIFICATE\n-----END CERTIFICATE-----";
const DEDICATED_PRIVATE = "private_dedicated_staging_key_0123456789";
const DEDICATED_PUBLIC = "public_dedicated_staging_key";
const APPLICATION_PRIVATE = "private_application_website_key_0123456789";
const ADMIN_URL = `postgresql://postgres.${STAGING_SUPABASE_REF}:fixture-admin@${POOLER_HOST}:5432/postgres`;

function source(overrides: Partial<Parameters<typeof prepareDesktop>[0]> = {}) {
  return {
    password: generateProvisioningPassword(),
    certificate: CERT,
    privateKey: DEDICATED_PRIVATE,
    publicKey: DEDICATED_PUBLIC,
    host: POOLER_HOST,
    adminDatabaseUrl: ADMIN_URL,
    ...overrides,
  };
}

function refusal(run: () => void): ProvisionRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof ProvisionRefusal) return error;
    throw error;
  }
  throw new Error("expected refusal");
}

describe("staging desktop provisioning", () => {
  it("defaults to a non-mutating check and accepts only an explicit apply", () => {
    expect(parseProvisionMode([])).toBe("check");
    expect(parseProvisionMode(["--check"])).toBe("check");
    expect(parseProvisionMode(["--apply"])).toBe("apply");
    expect(refusal(() => parseProvisionMode(["--apply", "--check"])).code).toBe("usage");
  });

  it("refuses the wrong branch, project, database, environment and admin set", () => {
    expect(refusal(() => assertPins({ branch: "main", projectId: "prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr", teamId: "team_nNF8inhmRhFvWkaLOl2cwdE6" })).phase).toBe("branch");
    expect(refusal(() => assertPins({ branch: "staging", projectId: "prj_wrong", teamId: "team_nNF8inhmRhFvWkaLOl2cwdE6" })).code).toBe("id");
    expect(refusal(() => assertConfiguredDatabaseProjects([
      `postgresql://postgres.${PRODUCTION_SUPABASE_REF}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`,
    ])).code).toBe("production_project");
    expect(refusal(() => assertAdminDatabaseUrl(
      `postgresql://postgres.${STAGING_SUPABASE_REF}:fixture@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
    )).code).toBe("admin_host");
    expect(refusal(() => assertAdminDatabaseUrl(
      `postgresql://itrader_stock_worker.${STAGING_SUPABASE_REF}:fixture@${POOLER_HOST}:5432/postgres`,
    )).code).toBe("admin_identity");
    const prepared = prepareDesktop(source());
    const config = JSON.parse(prepared.writes[1]?.value ?? "{}") as Record<string, Record<string, string>>;
    expect(Object.keys(config)).toEqual([...ADMIN_IDS]);
    expect(refusal(() => assertQueueEmpty(2)).phase).toBe("queue");
  });

  it("builds one shared staging config from the dedicated key pair only", () => {
    const input = source();
    const prepared = prepareDesktop(input);
    const config = JSON.parse(prepared.writes[1]?.value ?? "{}") as Record<string, Record<string, string>>;
    const first = config[ADMIN_IDS[0]];
    const second = config[ADMIN_IDS[1]];
    expect(first).toEqual(second);
    expect(first?.NODE_ENV).toBe("production");
    expect(first?.VERCEL_ENV).toBe("preview");
    expect(first?.ITRADER_DEPLOYMENT_ROLE).toBe("staging");
    expect(first?.DEALER_STOCK_SYNC_TARGET).toBe("preview");
    expect(first?.DEALER_STOCK_SYNC_WORKER).toBe("1");
    expect(first?.NEXT_PUBLIC_APP_URL).toBe(CANONICAL_ORIGIN);
    expect(first?.IMAGEKIT_PRIVATE_KEY).toBe(DEDICATED_PRIVATE);
    expect(first?.IMAGEKIT_PUBLIC_KEY).toBe(DEDICATED_PUBLIC);
    expect(JSON.stringify(config)).not.toContain(APPLICATION_PRIVATE);
    expect(JSON.stringify(config)).not.toContain("fixture-admin");
    expect(JSON.stringify(config)).not.toContain("IMAGEKIT_PRIVATE_KEY_FALLBACK");
    const identity = parseSupabaseConnectionIdentity(first?.DATABASE_URL ?? "");
    expect(identity).toMatchObject({ kind: "pooler", projectRef: STAGING_SUPABASE_REF, role: WORKER_ROLE });
    expect(new URL(first?.DATABASE_URL ?? "").hostname).toBe(POOLER_HOST);
    expect(new URL(first?.DATABASE_URL ?? "").port).toBe("5432");
    expect(resolveDesktopGate(buildGateEnv(ADMIN_URL, config)).ok).toBe(true);
    expect(prepared.writes[1]?.value.length).toBeLessThanOrEqual(48_000);
    expect(Object.keys(first ?? {}).sort()).not.toContain("POSTGRES_URL");
  });

  it("does not fall back to application ImageKit keys or unsafe hosts", () => {
    expect(refusal(() => assertDedicatedImageKit({
      privateKey: APPLICATION_PRIVATE,
      publicKey: DEDICATED_PUBLIC,
      applicationPrivateKey: APPLICATION_PRIVATE,
    })).code).toBe("application_fallback");
    expect(refusal(() => assertDedicatedImageKit({ privateKey: "private_short", publicKey: DEDICATED_PUBLIC })).code).toBe("private");
    expect(refusal(() => assertDedicatedImageKit({ privateKey: undefined, publicKey: undefined })).phase).toBe("imagekit_keys");
    expect(refusal(() => prepareDesktop(source({ host: "db.syneonzucehwlghqmfbg.supabase.co" }))).code).toBe("worker_host");
    expect(refusal(() => prepareDesktop(source({
      certificate: `-----BEGIN CERTIFICATE-----\n${"A".repeat(50_000)}\n-----END CERTIFICATE-----`,
    }))).code).toBe("size");
  });

  it("scopes every env write to staging preview sensitive values and enables last", () => {
    const writes = prepareDesktop(source()).writes;
    assertEnvWrites(writes);
    expect(writes.map((item) => item.key)).toEqual([
      "DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS",
      "DEALER_STOCK_DESKTOP_CONFIG_JSON",
      "DEALER_STOCK_DESKTOP_ENABLED",
    ]);
    for (const item of writes) {
      expect(item.type).toBe("sensitive");
      expect(item.gitBranch).toBe("staging");
      expect(item.target).toEqual(["preview"]);
    }
    expect(vercelEnvListUrl()).toContain("decrypt=false");
    expect(vercelEnvListUrl()).not.toContain("decrypt=true");
    expect(vercelEnvCreateUrl()).toContain("/v10/projects/");
    expect(buildEnvWrites(buildDesktopConfig(buildSharedWorkerEnv(source())))[2]?.value).toBe("1");
  });

  it("reuses a pinned recovery password and refuses an unknown login or inherited config", () => {
    const password = generateProvisioningPassword();
    const state = parseProvisionState(JSON.stringify(buildProvisionState(password)));
    const empty: EnvClassification = { own: [], conflicts: [], redisUrl: true, redisToken: true, desktopKeyPresent: false };
    expect(decideProvision({ loginEnabled: false, state: null, classification: empty })).toEqual({ action: "create" });
    expect(decideProvision({ loginEnabled: true, state, classification: empty })).toMatchObject({ action: "reuse", password, alreadyEnabled: true });
    expect(decideProvision({ loginEnabled: false, state, classification: empty })).toMatchObject({ action: "reuse", password, alreadyEnabled: false });
    expect(decideProvision({ loginEnabled: true, state: null, classification: empty }).action).toBe("refuse");
    const present = { ...empty, desktopKeyPresent: true };
    expect(decideProvision({ loginEnabled: false, state: null, classification: present })).toMatchObject({ code: "missing_state" });
    expect(decideProvision({
      loginEnabled: false,
      state,
      classification: { ...empty, conflicts: ["DEALER_STOCK_DESKTOP_ENABLED"] },
    })).toMatchObject({ code: "inherited_key" });
    expect(refusal(() => parseProvisionState('{"version":1}')).code).toBe("shape");
    expect(generateProvisioningPassword()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("keeps role SQL limited to the existing worker and requires refused privileged reads", () => {
    const password = generateProvisioningPassword();
    const activate = activationStatement(password);
    const disable = disableStatement();
    expect(activate).toContain(`ALTER ROLE ${WORKER_ROLE} WITH LOGIN PASSWORD`);
    expect(activate).not.toMatch(/GRANT|SET ROLE|POLICY|itrader_stock_matt|itrader_stock_dave/i);
    expect(disable).toBe(`ALTER ROLE ${WORKER_ROLE} WITH NOLOGIN`);
    expect(escapeLiteral("a'b")).toBe("a''b");
    expect(refusal(() => activationStatement("quote'not-safe")).code).toBe("password");
    expect(PROVISION_SQL.negativeEmail).toContain('WHERE false');
    expect(PROVISION_SQL.negativeRole).toContain('WHERE false');
    expect(PROVISION_SQL.negativeApproval).toContain('WHERE false');
    assertRestrictedWorker({ rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
    expect(refusal(() => assertRestrictedWorker({
      rolcanlogin: false, rolsuper: true, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false,
    })).code).toBe("restrictions");
    assertChildRoles(CHILD_ROLES.map((rolname) => ({ rolname, rolcanlogin: false })));
    expect(refusal(() => assertSmoke({
      currentUser: WORKER_ROLE, pendingJobs: 0, lockRowCount: 1, negativeRefused: [true, true, false],
    })).code).toBe("privileges");
    const alias = readAliasSnapshot({ alias: "itrader.im", deploymentId: "dpl_test", projectId: "prj_prod" });
    expect(() => assertAliasUnchanged(alias, { ...alias, deploymentId: "dpl_other" })).toThrow(ProvisionRefusal);
  });

  it("pins recovery outside the repo and keeps DPAPI scripts free of secret literals", () => {
    expect(privateTreeIgnored("/private/\n")).toBe(true);
    expect(provisioningStatePath("D:/Websites/iommarket").replaceAll("\\", "/")).toBe(
      "D:/Websites/iommarket/private/stock-update-desktop-build/provisioning/staging-shared.dpapi",
    );
    expect(DPAPI_SCRIPTS.protect).toContain("ProtectedData");
    expect(DPAPI_SCRIPTS.protect).toContain("CurrentUser");
    expect(DPAPI_SCRIPTS.unprotect).toContain("Unprotect");
    expect(DPAPI_SCRIPTS.acl).toContain("SetAccessRuleProtection");
    expect(`${DPAPI_SCRIPTS.protect}${DPAPI_SCRIPTS.unprotect}`).not.toContain("private_");
    const classified = classifyProjectEnv({
      envs: [
        { id: "own", key: "DEALER_STOCK_DESKTOP_ENABLED", type: "sensitive", gitBranch: "staging", target: ["preview"] },
        { id: "shared", key: "DEALER_STOCK_DESKTOP_ENABLED", type: "encrypted", target: ["preview"] },
        { key: "UPSTASH_REDIS_REST_URL", target: ["preview"] },
        { key: "UPSTASH_REDIS_REST_TOKEN", target: ["preview"] },
      ],
    });
    expect(classified.own).toEqual([{ id: "own", key: "DEALER_STOCK_DESKTOP_ENABLED" }]);
    expect(classified.conflicts).toEqual(["DEALER_STOCK_DESKTOP_ENABLED"]);
    expect(classified.redisUrl).toBe(true);
    expect(classified.redisToken).toBe(true);
  });
});

describe("permission-probe transaction isolation", () => {
  it("requires permission-denied, not an aborted transaction or network error", async () => {
    for (const code of ["42501", "25P02", "ECONNRESET"]) {
      const calls: string[] = [];
      const denied = await verifyPermissionDenied(async (sql) => {
        calls.push(sql);
        if (sql === "negative statement") throw Object.assign(new Error("synthetic"), { code });
      }, "negative statement");
      expect(denied).toBe(code === "42501");
      expect(calls).toEqual(["SAVEPOINT stock_permission_probe", "negative statement",
        "ROLLBACK TO SAVEPOINT stock_permission_probe", "RELEASE SAVEPOINT stock_permission_probe"]);
    }
  });
  it("does not treat permitted statements as denied", async () => {
    expect(await verifyPermissionDenied(async () => undefined, "permitted statement")).toBe(false);
  });
  it("does not borrow production-only or other-branch Redis settings", () => {
    for (const row of [{ target: ["production"] }, { target: ["preview"], gitBranch: "other" }]) {
      const actual = classifyProjectEnv({ envs: [
        { key: "UPSTASH_REDIS_REST_URL", ...row }, { key: "UPSTASH_REDIS_REST_TOKEN", ...row },
      ] });
      expect(actual.redisUrl || actual.redisToken).toBe(false);
    }
  });
});
