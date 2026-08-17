import { describe, expect, it, vi } from "vitest";
import { CostConfigError } from "@/lib/costs/config";
import {
  CostDeploymentError,
  normalizeDeploymentUrl,
  verifyProductionDeployment,
} from "@/lib/costs/vercel";

const env = {
  VERCEL_BILLING_TOKEN: "token",
  COST_VERCEL_TEAM_ID: "team_nNF8inhmRhFvWkaLOl2cwdE6",
  COST_VERCEL_PROJECT_ID: "prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr",
  COST_VERCEL_DATABASE_RESOURCE_ID: "store_1",
} as unknown as NodeJS.ProcessEnv;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("verified Vercel deployments T3", () => {
  it("normalizes a hostname-only deployment URL", () => {
    expect(normalizeDeploymentUrl("iommarket.vercel.app")).toBe(
      "https://iommarket.vercel.app",
    );
  });

  it("accepts a ready production deployment for the configured project", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        uid: "dpl_ready",
        readyState: "READY",
        target: "production",
        project: { id: env.COST_VERCEL_PROJECT_ID },
        team: { id: env.COST_VERCEL_TEAM_ID },
      }),
    );

    await expect(
      verifyProductionDeployment({
        deploymentUrl: "https://iommarket.vercel.app",
        env,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual({
      status: "production",
      uid: "dpl_ready",
      projectId: env.COST_VERCEL_PROJECT_ID,
    });
  });

  it("returns preview instead of syncing a verified preview deployment", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "dpl_preview",
        readyState: "READY",
        target: "preview",
        projectId: env.COST_VERCEL_PROJECT_ID,
        ownerId: env.COST_VERCEL_TEAM_ID,
      }),
    );

    await expect(
      verifyProductionDeployment({
        deploymentUrl: "https://iommarket-git-preview.vercel.app",
        env,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual({
      status: "preview",
      uid: "dpl_preview",
      projectId: env.COST_VERCEL_PROJECT_ID,
    });
  });

  it("fails closed for the wrong team, project, or unreadiness", async () => {
    await expect(
      verifyProductionDeployment({
        deploymentUrl: "https://other.vercel.app",
        env,
        fetchImpl: vi.fn().mockResolvedValue(
          jsonResponse({
            uid: "dpl_other_team",
            readyState: "READY",
            target: "production",
            projectId: env.COST_VERCEL_PROJECT_ID,
            teamId: "team_other",
          }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(CostDeploymentError);

    await expect(
      verifyProductionDeployment({
        deploymentUrl: "https://other-project.vercel.app",
        env,
        fetchImpl: vi.fn().mockResolvedValue(
          jsonResponse({
            uid: "dpl_other_project",
            readyState: "READY",
            target: "production",
            projectId: "prj_other",
            teamId: env.COST_VERCEL_TEAM_ID,
          }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(CostDeploymentError);

    await expect(
      verifyProductionDeployment({
        deploymentUrl: "https://building.vercel.app",
        env,
        fetchImpl: vi.fn().mockResolvedValue(
          jsonResponse({
            uid: "dpl_building",
            readyState: "BUILDING",
            target: "production",
            projectId: env.COST_VERCEL_PROJECT_ID,
            teamId: env.COST_VERCEL_TEAM_ID,
          }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(CostDeploymentError);
  });

  it("fails closed when billing identifiers are missing", async () => {
    await expect(
      verifyProductionDeployment({
        deploymentUrl: "https://iommarket.vercel.app",
        env: {} as unknown as NodeJS.ProcessEnv,
      }),
    ).rejects.toBeInstanceOf(CostConfigError);
  });
});
