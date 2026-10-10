import { describe, expect, it, vi } from "vitest";
import {
  assertConfigPathAllowed,
  buildIsolatedEnv,
  loadWorkerConfig,
  runLauncher,
  safeErrorMessage,
  type LauncherIo,
} from "../../scripts/dealer-stock-sync/pc-launcher";
import { bindStop, processTick, runWatchLoop, workerMode } from "../../scripts/dealer-stock-sync/worker-cli";

const previewRef = "syneonzucehwlghqmfbg";
const prodRef = "snlqivvogfqesxpbjiei";
const CERT = "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----";
const PARENT_SECRET = "parent-only-secret-value";

function direct(ref: string) {
  return `postgresql://postgres:fixture@db.${ref}.supabase.co:5432/postgres`;
}

function previewFile(overrides: Record<string, string> = {}) {
  return {
    DEALER_STOCK_SYNC_WORKER: "1",
    DEALER_STOCK_SYNC_TARGET: "preview",
    VERCEL_ENV: "preview",
    ITRADER_DEPLOYMENT_ROLE: "staging",
    NEXT_PUBLIC_APP_URL: "https://itrader.dev",
    NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co`,
    DATABASE_URL: direct(previewRef),
    POSTGRES_URL: direct(previewRef),
    POSTGRES_URL_NON_POOLING: direct(previewRef),
    SUPABASE_DB_CA_CERT: CERT,
    MEDIA_PROVIDER: "imagekit",
    NEXT_PUBLIC_MEDIA_PROVIDER: "imagekit",
    MEDIA_UPLOAD_PROVIDER: "imagekit",
    IMAGEKIT_UPLOADS_ENABLED: "1",
    IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
    IMAGEKIT_PUBLIC_KEY: "public_test_key",
    IMAGEKIT_PRIVATE_KEY: "private_test_key_value_0123456789",
    ...overrides,
  };
}

function fileText(env: Record<string, string>) {
  return Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n");
}

function launcher(file: Record<string, string> | null, parent: Record<string, string | undefined> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const spawned: Array<{ env: Record<string, string>; args: string[] }> = [];
  const io: LauncherIo = {
    cwd: "C:\\repo",
    parentEnv: {
      PATH: "C:\\Windows\\system32",
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      DATABASE_URL: `postgresql://postgres:${PARENT_SECRET}@db.${prodRef}.supabase.co:5432/postgres`,
      IMAGEKIT_PRIVATE_KEY: "private_parent_key_should_not_pass",
      NEXT_PUBLIC_APP_URL: "https://itrader.im",
      NODE_ENV: "development",
      VERCEL_ENV: "production",
      ...parent,
    },
    nodeVersion: "22.14.0",
    exists: () => file !== null,
    readText: () => {
      if (!file) throw new Error("missing");
      return fileText(file);
    },
    tsxInstalled: true,
    chromiumInstalled: true,
    write: (line) => stdout.push(line),
    writeError: (line) => stderr.push(line),
    spawnWorker: async (input) => {
      spawned.push({ env: input.env, args: input.args });
      return 0;
    },
  };
  return { io, stdout, stderr, spawned };
}

describe("dealer stock PC launcher", () => {
  it("isolates the child from ambient credentials and keeps the production flag unset", async () => {
    const { io, stdout, spawned } = launcher(previewFile());
    const code = await runLauncher(["--target", "preview", "--check"], io);

    expect(code).toBe(0);
    expect(spawned).toHaveLength(0);
    expect(stdout.join("")).toContain("Site: https://itrader.dev");
    expect(stdout.join("")).toContain("Weekly scrapes: off");
    expect(stdout.join("")).toContain("No database connection was opened.");
    expect(stdout.join("")).not.toContain(PARENT_SECRET);

    const started = launcher(previewFile());
    await runLauncher(["--target", "preview"], started.io);
    expect(started.spawned).toHaveLength(1);
    expect(started.spawned[0].args).toEqual([
      "--import", "tsx", "scripts/dealer-stock-sync/worker-cli.ts", "--watch", "--manual",
    ]);
    expect(started.spawned[0].env.PATH).toBe("C:\\Windows\\system32");
    expect(started.spawned[0].env.DATABASE_URL).toBe(direct(previewRef));
    expect(started.spawned[0].env.DATABASE_URL).not.toContain(PARENT_SECRET);
    expect(started.spawned[0].env.IMAGEKIT_PRIVATE_KEY).toBe("private_test_key_value_0123456789");
    expect(started.spawned[0].env.NODE_ENV).toBeUndefined();
    expect(started.spawned[0].env.VERCEL_ENV).toBe("preview");
    expect(started.spawned[0].env.DEALER_STOCK_SYNC_PRODUCTION_ENABLED).toBeUndefined();
    expect(JSON.stringify(started.spawned[0].env)).not.toContain(PARENT_SECRET);
  });

  it("rejects a mismatched target, a foreign database, and a missing file", async () => {
    const wrongTarget = launcher(previewFile({ DEALER_STOCK_SYNC_TARGET: "production" }));
    expect(await runLauncher(["--target", "preview"], wrongTarget.io)).toBe(1);
    expect(wrongTarget.stderr.join("")).toMatch(/does not match the selected preview worker/);
    expect(wrongTarget.spawned).toHaveLength(0);

    const wrongDatabase = launcher(previewFile({ DATABASE_URL: direct(prodRef) }));
    expect(await runLauncher(["--target", "preview"], wrongDatabase.io)).toBe(1);
    expect(wrongDatabase.stderr.join("")).toMatch(/database does not match/);
    expect(wrongDatabase.spawned).toHaveLength(0);
    expect(wrongDatabase.stderr.join("")).not.toContain(PARENT_SECRET);

    const missing = launcher(null);
    expect(await runLauncher(["--target", "preview", "--check"], missing.io)).toBe(1);
    expect(missing.stderr.join("")).toMatch(/Missing worker configuration/);
    expect(missing.spawned).toHaveLength(0);

    expect(() => assertConfigPathAllowed("C:\\repo\\.env.local")).toThrow(/Refusing/);
  });

  it("does not force production on and redacts configuration values", async () => {
    const production = previewFile({
      DEALER_STOCK_SYNC_TARGET: "production",
      VERCEL_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://itrader.im",
      NEXT_PUBLIC_SUPABASE_URL: `https://${prodRef}.supabase.co`,
      DATABASE_URL: direct(prodRef),
      POSTGRES_URL: direct(prodRef),
      POSTGRES_URL_NON_POOLING: direct(prodRef),
    });
    const { io, stderr, spawned } = launcher(production);
    expect(await runLauncher(["--target", "production"], io)).toBe(1);
    expect(stderr.join("")).toMatch(/disabled in production/);
    expect(spawned).toHaveLength(0);

    const leaked = `postgresql://postgres:${PARENT_SECRET}@db.example/postgres`;
    expect(safeErrorMessage(new Error(`failed ${leaked}`), [leaked])).not.toContain(PARENT_SECRET);
    const parsed = loadWorkerConfig('DEALER_STOCK_SYNC_TARGET=preview\n# comment\nIMAGEKIT_PRIVATE_KEY="private_test_key_value_0123456789"\n');
    expect(parsed.DEALER_STOCK_SYNC_TARGET).toBe("preview");
    expect(parsed.IMAGEKIT_PRIVATE_KEY).toBe("private_test_key_value_0123456789");
    expect(buildIsolatedEnv({ DATABASE_URL: leaked, PATH: "C:\\Windows" }, parsed).DATABASE_URL).toBeUndefined();
  });
});

describe("manual dealer stock worker", () => {
  it("finishes an in-flight job and never leases another after stopping", async () => {
    const stop = bindStop(() => undefined);
    const leaseOneJob = vi.fn(async () => ({ id: "in-flight", owner: "lease-owner" }));
    let completed = false;
    await runWatchLoop({
      manual: true, once: false, isStopped: stop.isStopped,
      write: () => undefined, pause: async () => undefined,
      tick: () => processTick({
        env: previewFile(), manual: true, isStopped: stop.isStopped,
        enqueueWeekly: async () => { throw new Error("Must not schedule"); },
        leaseOneJob, write: () => undefined,
        runJob: async () => { stop.requestStop(); await Promise.resolve(); completed = true; },
      }),
    });
    expect(completed).toBe(true);
    expect(leaseOneJob).toHaveBeenCalledOnce();
  });

  it("rejects mixed fallback databases, invalid media destinations and missing prerequisites", async () => {
    const configurations: Record<string, string>[] = [
      { POSTGRES_URL_NON_POOLING: direct(prodRef) },
      { ITRADER_DEPLOYMENT_ROLE: "wrong" },
      { IMAGEKIT_PRIVATE_KEY: "" },
    ];
    for (const overrides of configurations) {
      const candidate = launcher(previewFile(overrides));
      expect(await runLauncher(["--target", "preview", "--check"], candidate.io)).toBe(1);
      expect(candidate.spawned).toHaveLength(0);
    }
    for (const override of [{ chromiumInstalled: false }, { nodeVersion: "20.1.0" }, { tsxInstalled: false }]) {
      const candidate = launcher(previewFile());
      Object.assign(candidate.io, override);
      expect(await runLauncher(["--target", "preview"], candidate.io)).toBe(1);
      expect(candidate.spawned).toHaveLength(0);
    }
  });

  it("skips the weekly scheduler and stops after the current job", async () => {
    expect(workerMode(["--watch", "--manual"])).toMatchObject({ once: false, manual: true });
    expect(workerMode(["--watch"])).toMatchObject({ manual: false });
    expect(workerMode(["--once", "--watch"])).toHaveProperty("error");

    const enqueueWeekly = vi.fn(async () => undefined);
    const leaseOneJob = vi.fn(async () => ({ id: "job-1", owner: "lease-owner" }));
    const runJob = vi.fn(async () => undefined);
    const env = previewFile();
    await processTick({
      env,
      manual: true,
      isStopped: () => false,
      enqueueWeekly,
      leaseOneJob,
      runJob,
      write: () => undefined,
    });
    expect(enqueueWeekly).not.toHaveBeenCalled();
    expect(runJob).toHaveBeenCalledWith({ id: "job-1", owner: "lease-owner" });

    enqueueWeekly.mockClear();
    await processTick({
      env,
      manual: false,
      isStopped: () => false,
      enqueueWeekly,
      leaseOneJob: async () => null,
      runJob,
      write: () => undefined,
    });
    expect(enqueueWeekly).toHaveBeenCalledOnce();

    const lines: string[] = [];
    const stop = bindStop((line) => lines.push(line));
    stop.requestStop();
    stop.requestStop();
    expect(lines).toEqual(["Stopping after the current job finishes.\n"]);
    expect(stop.isStopped()).toBe(true);
  });
});
