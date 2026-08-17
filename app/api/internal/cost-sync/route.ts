import { NextRequest, NextResponse } from "next/server";
import {
  isBearerSecretAuthorized,
  isCostSyncNonProdAllowed,
  isCostsEnabled,
  isProductionRuntime,
} from "@/lib/costs/config";
import { runCostSync } from "@/lib/costs/sync";
import {
  CostDeploymentError,
  verifyProductionDeployment,
} from "@/lib/costs/vercel";
import { costSyncRequestSchema } from "@/lib/validations/costs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The Vercel FOCUS billing endpoint streams slowly and is retried up to three times.
export const maxDuration = 180;

function syncStatusCode(status: "skipped" | "locked" | "succeeded" | "failed"): number {
  if (status === "failed") return 502;
  if (status === "locked") return 409;
  return 200;
}

export async function POST(request: NextRequest) {
  if (!isBearerSecretAuthorized(
    request.headers.get("authorization"),
    process.env.COST_SYNC_SECRET,
  )) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  if (!isProductionRuntime() && !isCostSyncNonProdAllowed()) {
    return NextResponse.json({ error: "Production only" }, { status: 403 });
  }

  if (!isCostsEnabled()) {
    return NextResponse.json({ data: { status: "skipped" } });
  }

  let deploymentUrl: string;
  try {
    const parsed = costSyncRequestSchema.safeParse(await request.json());
    if (!parsed.success || !parsed.data.deploymentUrl) {
      return NextResponse.json({ error: "A deployment URL is required." }, { status: 400 });
    }
    deploymentUrl = parsed.data.deploymentUrl;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const deployment = await verifyProductionDeployment({ deploymentUrl });
    if (deployment.status === "preview") {
      return NextResponse.json({ data: { status: "skipped" } });
    }

    const result = await runCostSync({
      trigger: "DEPLOYMENT",
      eventId: deployment.uid,
    });
    return NextResponse.json({ data: result }, { status: syncStatusCode(result.status) });
  } catch (error) {
    if (error instanceof CostDeploymentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Deployment could not be verified." }, { status: 400 });
  }
}
