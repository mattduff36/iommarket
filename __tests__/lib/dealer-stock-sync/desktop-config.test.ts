import { describe, expect, it } from "vitest";
import { resolveDesktopGate } from "@/lib/dealer-stock-sync/desktop-config";

const CERT = "-----BEGIN CERTIFICATE-----\nMIIBTESTCERTIFICATE\n-----END CERTIFICATE-----";
const ADMIN_A = "cadmin0000000000000000001";
const ADMIN_B = "cadmin0000000000000000002";
const PRIVATE_KEY = "private_test_key_value_0123456789";

function databaseUrl(project: string, password: string): string {
  return `postgresql://postgres:${password}@db.${project}.supabase.co:5432/postgres`;
}

function workerEnv(target: "preview" | "production", password: string, privateKey = PRIVATE_KEY): Record<string, string> {
  const preview = target === "preview";
  const project = preview ? "syneonzucehwlghqmfbg" : "snlqivvogfqesxpbjiei";
  return {
    DEALER_STOCK_SYNC_TARGET: target,
    VERCEL_ENV: target,
    ...(preview ? { ITRADER_DEPLOYMENT_ROLE: "staging" } : { DEALER_STOCK_SYNC_PRODUCTION_ENABLED: "1" }),
    NODE_ENV: "production",
    DEALER_STOCK_SYNC_WORKER: "1",
    NEXT_PUBLIC_APP_URL: preview ? "https://itrader.dev" : "https://itrader.im",
    NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
    DATABASE_URL: databaseUrl(project, password),
    POSTGRES_URL: databaseUrl(project, password),
    POSTGRES_URL_NON_POOLING: databaseUrl(project, password),
    SUPABASE_DB_CA_CERT: CERT,
    MEDIA_PROVIDER: "imagekit",
    NEXT_PUBLIC_MEDIA_PROVIDER: "imagekit",
    MEDIA_UPLOAD_PROVIDER: "imagekit",
    IMAGEKIT_UPLOADS_ENABLED: "1",
    IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
    IMAGEKIT_PUBLIC_KEY: "public_test_key",
    IMAGEKIT_PRIVATE_KEY: privateKey,
  };
}

function desktopEnv(
  workers: Record<string, Record<string, string>>,
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const target = Object.values(workers)[0]?.DEALER_STOCK_SYNC_TARGET === "production" ? "production" : "preview";
  const project = target === "preview" ? "syneonzucehwlghqmfbg" : "snlqivvogfqesxpbjiei";
  return {
    DEALER_STOCK_DESKTOP_ENABLED: "1",
    DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: Object.keys(workers).join(","),
    DEALER_STOCK_DESKTOP_CONFIG_JSON: JSON.stringify(workers),
    VERCEL_ENV: target,
    DEALER_STOCK_SYNC_TARGET: target,
    NEXT_PUBLIC_APP_URL: target === "preview" ? "https://itrader.dev" : "https://itrader.im",
    NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
    DATABASE_URL: databaseUrl(project, "app-secret"),
    POSTGRES_URL: databaseUrl(project, "app-secret"),
    POSTGRES_URL_NON_POOLING: databaseUrl(project, "app-secret"),
    ...(target === "production" ? { DEALER_STOCK_SYNC_PRODUCTION_ENABLED: "1" } : {}),
    ...overrides,
  };
}

describe("desktop worker config", () => {
  it("accepts one or two allowlisted admins and keeps worker credentials separate", () => {
    const worker = workerEnv("preview", "worker-secret");
    const gate = resolveDesktopGate(desktopEnv({ [ADMIN_A]: worker, [ADMIN_B]: workerEnv("preview", "other-worker") }));
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.gate.environment).toBe("preview");
    expect(gate.gate.origin).toBe("https://itrader.dev");
    expect(gate.gate.configs[ADMIN_A]?.DATABASE_URL).toContain("worker-secret");
    expect(gate.gate.configs[ADMIN_A]?.DATABASE_URL).not.toContain("app-secret");
    expect(JSON.stringify(gate)).not.toContain("app-secret");
  });

  it("accepts one DB URL and rejects absent or cross-environment connections", () => {
    const worker = workerEnv("preview", "worker-secret");
    delete worker.POSTGRES_URL;
    worker.POSTGRES_URL_NON_POOLING = "";
    expect(resolveDesktopGate(desktopEnv({ [ADMIN_A]: worker })).ok).toBe(true);
    worker.POSTGRES_URL = databaseUrl("snlqivvogfqesxpbjiei", "other");
    expect(resolveDesktopGate(desktopEnv({ [ADMIN_A]: worker })).ok).toBe(false);
    delete worker.POSTGRES_URL;
    delete worker.DATABASE_URL;
    expect(resolveDesktopGate(desktopEnv({ [ADMIN_A]: worker })).ok).toBe(false);
  });

  it("fails closed when disabled, the allowlist is empty, or ids are not internal user ids", () => {
    const worker = { [ADMIN_A]: workerEnv("preview", "worker-secret") };
    expect(resolveDesktopGate(desktopEnv(worker, { DEALER_STOCK_DESKTOP_ENABLED: undefined })).ok).toBe(false);
    expect(resolveDesktopGate(desktopEnv(worker, { DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: "" }))).toMatchObject({ ok: false, reason: "allowlist" });
    expect(resolveDesktopGate(desktopEnv(worker, { DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: "admin@example.com" }))).toMatchObject({ ok: false, reason: "allowlist" });
    expect(resolveDesktopGate(desktopEnv(worker, {
      DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: `${ADMIN_A},${ADMIN_B},cadmin0000000000000000003`,
      DEALER_STOCK_DESKTOP_CONFIG_JSON: JSON.stringify({
        [ADMIN_A]: workerEnv("preview", "worker-secret"),
        [ADMIN_B]: workerEnv("preview", "worker-secret"),
        cadmin0000000000000000003: workerEnv("preview", "worker-secret"),
      }),
    }))).toMatchObject({ ok: false, reason: "allowlist" });
  });

  it("rejects unsafe keys and does not borrow application database credentials", () => {
    const worker = workerEnv("preview", "worker-secret");
    const withCommand = { ...worker, NODE_OPTIONS: "--inspect" };
    const withPath = { ...worker, PATH: "C:\\Windows" };
    expect(resolveDesktopGate(desktopEnv({ [ADMIN_A]: withCommand }))).toMatchObject({ ok: false, reason: "config" });
    expect(resolveDesktopGate(desktopEnv({ [ADMIN_A]: withPath }))).toMatchObject({ ok: false, reason: "config" });
    const incomplete = { ...worker };
    delete incomplete.DATABASE_URL;
    delete incomplete.POSTGRES_URL;
    delete incomplete.POSTGRES_URL_NON_POOLING;
    const gate = resolveDesktopGate(desktopEnv({ [ADMIN_A]: incomplete }));
    expect(gate.ok).toBe(false);
    expect(JSON.stringify(gate)).not.toContain("app-secret");
    expect(JSON.stringify(gate)).not.toContain(PRIVATE_KEY);
  });

  it("requires the existing production activation flag and a matching worker target", () => {
    const production = workerEnv("production", "worker-secret");
    const missingFlag = desktopEnv({ [ADMIN_A]: production }, { DEALER_STOCK_SYNC_PRODUCTION_ENABLED: undefined });
    expect(resolveDesktopGate(missingFlag)).toMatchObject({ ok: false, reason: "production_flag" });
    const crossed = desktopEnv({ [ADMIN_A]: production });
    crossed.VERCEL_ENV = "preview";
    crossed.DEALER_STOCK_SYNC_TARGET = "preview";
    crossed.NEXT_PUBLIC_APP_URL = "https://itrader.dev";
    crossed.NEXT_PUBLIC_SUPABASE_URL = "https://syneonzucehwlghqmfbg.supabase.co";
    crossed.DATABASE_URL = databaseUrl("syneonzucehwlghqmfbg", "app-secret");
    crossed.POSTGRES_URL = crossed.DATABASE_URL;
    crossed.POSTGRES_URL_NON_POOLING = crossed.DATABASE_URL;
    delete crossed.DEALER_STOCK_SYNC_PRODUCTION_ENABLED;
    expect(resolveDesktopGate(crossed).ok).toBe(false);
    expect(resolveDesktopGate(desktopEnv({ [ADMIN_A]: production })).ok).toBe(true);
  });
});
