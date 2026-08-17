/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { runCostSync, verifyProductionDeployment, CostDeploymentError } = vi.hoisted(() => {
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
  };
});

vi.mock("@/lib/costs/sync", () => ({
  runCostSync,
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
    allow: string | undefined;
    vercelEnv: string | undefined;
  };

  beforeEach(() => {
    previous = {
      secret: process.env.COST_SYNC_SECRET,
      enabled: process.env.COSTS_ENABLED,
      allow: process.env.COST_SYNC_ALLOW_NON_PROD,
      vercelEnv: process.env.VERCEL_ENV,
    };
    vi.clearAllMocks();
    process.env.COST_SYNC_SECRET = "sync-secret";
    process.env.COSTS_ENABLED = "true";
    process.env.COST_SYNC_ALLOW_NON_PROD = "1";
    process.env.VERCEL_ENV = "development";
    runCostSync.mockResolvedValue({ status: "succeeded", runId: "run_1" });
    verifyProductionDeployment.mockResolvedValue({
      status: "production",
      uid: "dpl_ready",
      projectId: "prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr",
    });
  });

  afterEach(() => {
    restoreEnv("COST_SYNC_SECRET", previous.secret);
    restoreEnv("COSTS_ENABLED", previous.enabled);
    restoreEnv("COST_SYNC_ALLOW_NON_PROD", previous.allow);
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

  it("rejects a Vercel preview runtime even when NODE_ENV is production", async () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.COST_SYNC_ALLOW_NON_PROD;
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
});
