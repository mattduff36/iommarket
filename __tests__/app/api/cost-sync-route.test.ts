/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { runCostSync, verifyProductionDeployment, CostDeploymentError, readAccountsReaderSync } = vi.hoisted(() => {
  class CostDeploymentError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CostDeploymentError";
    }
  }
  return {
    runCostSync: vi.fn(),
    verifyProductionDeployment: vi.fn(),
    CostDeploymentError,
    readAccountsReaderSync: vi.fn(),
  };
});

vi.mock("@/lib/costs/sync", () => ({
  runCostSync,
}));

vi.mock("@/lib/costs/accounts-health", () => ({
  readAccountsReaderSync,
  closedAccountsReaderSync: (
    sync: { status: "succeeded" | "failed"; source: "accounts" } | null,
  ) => sync ?? { status: "failed" as const, source: "accounts" as const },
}));

vi.mock("@/lib/costs/vercel", async () => {
  const actual = await vi.importActual<typeof import("@/lib/costs/vercel")>(
    "@/lib/costs/vercel",
  );
  return {
    ...actual,
    CostDeploymentError,
    verifyProductionDeployment,
  };
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("internal cost sync route T3", () => {
  let previous: {
    secret: string | undefined;
    enabled: string | undefined;
    vercelEnv: string | undefined;
  };

  beforeEach(() => {
    previous = {
      secret: process.env.COST_SYNC_SECRET,
      enabled: process.env.COSTS_ENABLED,
      vercelEnv: process.env.VERCEL_ENV,
    };
    vi.clearAllMocks();
    process.env.COST_SYNC_SECRET = "sync-secret";
    process.env.COSTS_ENABLED = "true";
    process.env.COST_LEDGER_ROLE = "canonical";
    delete process.env.VERCEL_PROJECT_ID;
    delete process.env.COST_CANONICAL_VERCEL_PROJECT_ID;
    process.env.VERCEL_ENV = "development";
    runCostSync.mockResolvedValue({ status: "succeeded", runId: "run_1" });
    readAccountsReaderSync.mockResolvedValue({
      status: "succeeded",
      source: "accounts",
      asOf: "2026-10-21T09:00:00.000Z",
      sourceUpdatedAt: "2026-10-20T08:00:00.000Z",
    });
    verifyProductionDeployment.mockResolvedValue({
      status: "production",
      uid: "dpl_ready",
      projectId: "prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr",
    });
  });

  afterEach(() => {
    restoreEnv("COST_SYNC_SECRET", previous.secret);
    restoreEnv("COSTS_ENABLED", previous.enabled);
    restoreEnv("VERCEL_ENV", previous.vercelEnv);
  });

  it("rejects unauthorized POSTs", async () => {
    const { POST } = await import("@/app/api/internal/cost-sync/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/internal/cost-sync", {
        method: "POST",
        body: JSON.stringify({ deploymentUrl: "https://iommarket.vercel.app" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(runCostSync).not.toHaveBeenCalled();
  });

  it("rejects a hosted deployment that is not the pinned canonical writer", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.COST_LEDGER_ROLE = "canonical";
    process.env.VERCEL_PROJECT_ID = "prj_staging";
    process.env.COST_CANONICAL_VERCEL_PROJECT_ID = "prj_live";
    const { POST } = await import("@/app/api/internal/cost-sync/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/internal/cost-sync", {
        method: "POST",
        headers: {
          authorization: "Bearer sync-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ deploymentUrl: "https://iommarket.vercel.app" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(runCostSync).not.toHaveBeenCalled();
  });

  it("requires a deployment URL and does not trust caller target claims", async () => {
    const { POST } = await import("@/app/api/internal/cost-sync/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/internal/cost-sync", {
        method: "POST",
        headers: {
          authorization: "Bearer sync-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ eventId: "dpl_1", target: "production" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(runCostSync).not.toHaveBeenCalled();
  });

  it("synchronizes a verified production deployment URL", async () => {
    const { POST } = await import("@/app/api/internal/cost-sync/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/internal/cost-sync", {
        method: "POST",
        headers: {
          authorization: "Bearer sync-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deploymentUrl: "https://iommarket.vercel.app",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(readAccountsReaderSync).not.toHaveBeenCalled();
    expect(runCostSync).toHaveBeenCalledWith({
      trigger: "DEPLOYMENT",
      eventId: "dpl_ready",
    });
    await expect(response.json()).resolves.toEqual({
      data: { status: "succeeded", runId: "run_1" },
    });
  });

  it("skips a verified preview deployment without syncing", async () => {
    verifyProductionDeployment.mockResolvedValue({
      status: "preview",
      uid: "dpl_preview",
      projectId: "prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr",
    });
    const { POST } = await import("@/app/api/internal/cost-sync/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/internal/cost-sync", {
        method: "POST",
        headers: {
          authorization: "Bearer sync-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deploymentUrl: "https://iommarket-git-preview.vercel.app",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(runCostSync).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      data: { status: "skipped" },
    });
  });

  it("fails closed when the deployment cannot be verified", async () => {
    verifyProductionDeployment.mockRejectedValue(
      new CostDeploymentError("Deployment could not be verified."),
    );
    const { POST } = await import("@/app/api/internal/cost-sync/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/internal/cost-sync", {
        method: "POST",
        headers: {
          authorization: "Bearer sync-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deploymentUrl: "https://unknown.vercel.app",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(runCostSync).not.toHaveBeenCalled();
  });

  it("returns a non-2xx status when sync fails", async () => {
    runCostSync.mockResolvedValue({ status: "failed", errorCode: "CostFxError" });
    const { POST } = await import("@/app/api/internal/cost-sync/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/internal/cost-sync", {
        method: "POST",
        headers: {
          authorization: "Bearer sync-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deploymentUrl: "https://iommarket.vercel.app",
        }),
      }),
    );
    expect(response.status).toBe(502);
  });

  it("keeps accounts-preview on the canonical writer gate", async () => {
    process.env.COST_LEDGER_ROLE = "accounts-preview";
    const { POST } = await import("@/app/api/internal/cost-sync/route");
    const response = await POST(authorizedDeploymentRequest());
    expect(response.status).toBe(403);
    expect(verifyProductionDeployment).not.toHaveBeenCalled();
    expect(readAccountsReaderSync).not.toHaveBeenCalled();
    expect(runCostSync).not.toHaveBeenCalled();
  });

  describe("accounts-reader", () => {
    beforeEach(() => {
      process.env.COST_LEDGER_ROLE = "accounts-reader";
    });

    it("rejects unauthorized POSTs before reading Accounts", async () => {
      const { POST } = await import("@/app/api/internal/cost-sync/route");
      const response = await POST(
        new NextRequest("http://localhost:4000/api/internal/cost-sync", {
          method: "POST",
          body: JSON.stringify({ deploymentUrl: "https://iommarket.vercel.app" }),
        }),
      );
      expect(response.status).toBe(401);
      expect(readAccountsReaderSync).not.toHaveBeenCalled();
      expect(runCostSync).not.toHaveBeenCalled();
    });

    it("does not read Accounts when costs are disabled", async () => {
      process.env.COSTS_ENABLED = "false";
      const { POST } = await import("@/app/api/internal/cost-sync/route");
      const response = await POST(authorizedDeploymentRequest());
      expect(response.status).toBe(200);
      expect(verifyProductionDeployment).not.toHaveBeenCalled();
      expect(readAccountsReaderSync).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({ data: { status: "skipped" } });
    });

    it("requires a deployment URL before reading Accounts", async () => {
      const { POST } = await import("@/app/api/internal/cost-sync/route");
      const response = await POST(
        new NextRequest("http://localhost:4000/api/internal/cost-sync", {
          method: "POST",
          headers: {
            authorization: "Bearer sync-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ target: "production" }),
        }),
      );
      expect(response.status).toBe(400);
      expect(verifyProductionDeployment).not.toHaveBeenCalled();
      expect(readAccountsReaderSync).not.toHaveBeenCalled();
      expect(runCostSync).not.toHaveBeenCalled();
    });

    it("rejects invalid JSON before reading Accounts", async () => {
      const { POST } = await import("@/app/api/internal/cost-sync/route");
      const response = await POST(
        new NextRequest("http://localhost:4000/api/internal/cost-sync", {
          method: "POST",
          headers: {
            authorization: "Bearer sync-secret",
            "content-type": "application/json",
          },
          body: "{",
        }),
      );
      expect(response.status).toBe(400);
      expect(readAccountsReaderSync).not.toHaveBeenCalled();
      expect(runCostSync).not.toHaveBeenCalled();
    });

    it("skips a verified preview deployment without reading Accounts", async () => {
      verifyProductionDeployment.mockResolvedValue({
        status: "preview",
        uid: "dpl_preview",
        projectId: "prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr",
      });
      const { POST } = await import("@/app/api/internal/cost-sync/route");
      const response = await POST(authorizedDeploymentRequest("https://iommarket-git-preview.vercel.app"));
      expect(response.status).toBe(200);
      expect(readAccountsReaderSync).not.toHaveBeenCalled();
      expect(runCostSync).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({ data: { status: "skipped" } });
    });

    it("does not read Accounts when deployment verification fails", async () => {
      verifyProductionDeployment.mockRejectedValue(
        new CostDeploymentError("Deployment could not be verified."),
      );
      const { POST } = await import("@/app/api/internal/cost-sync/route");
      const response = await POST(authorizedDeploymentRequest("https://unknown.vercel.app"));
      expect(response.status).toBe(400);
      expect(readAccountsReaderSync).not.toHaveBeenCalled();
      expect(runCostSync).not.toHaveBeenCalled();
    });

    it("returns succeeded metadata after a verified production deployment", async () => {
      readAccountsReaderSync.mockImplementation(async () => {
        expect(verifyProductionDeployment).toHaveBeenCalled();
        return {
          status: "succeeded",
          source: "accounts",
          asOf: "2026-10-21T09:00:00.000Z",
          sourceUpdatedAt: "2026-10-20T08:00:00.000Z",
        };
      });
      const { POST } = await import("@/app/api/internal/cost-sync/route");
      const response = await POST(authorizedDeploymentRequest());
      expect(response.status).toBe(200);
      expect(readAccountsReaderSync).toHaveBeenCalledTimes(1);
      expect(runCostSync).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        data: {
          status: "succeeded",
          source: "accounts",
          asOf: "2026-10-21T09:00:00.000Z",
          sourceUpdatedAt: "2026-10-20T08:00:00.000Z",
        },
      });
    });

    it("fails closed when Accounts billing is unavailable", async () => {
      readAccountsReaderSync.mockResolvedValue({ status: "failed", source: "accounts" });
      const { POST } = await import("@/app/api/internal/cost-sync/route");
      const response = await POST(authorizedDeploymentRequest());
      expect(response.status).toBe(502);
      expect(runCostSync).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        data: { status: "failed", source: "accounts" },
      });
    });

    it("fails closed when the Accounts read returns nothing", async () => {
      readAccountsReaderSync.mockResolvedValue(null);
      const { POST } = await import("@/app/api/internal/cost-sync/route");
      const response = await POST(authorizedDeploymentRequest());
      expect(response.status).toBe(502);
      expect(runCostSync).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        data: { status: "failed", source: "accounts" },
      });
    });
  });
});

function authorizedDeploymentRequest(deploymentUrl = "https://iommarket.vercel.app"): NextRequest {
  return new NextRequest("http://localhost:4000/api/internal/cost-sync", {
    method: "POST",
    headers: {
      authorization: "Bearer sync-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ deploymentUrl }),
  });
}
