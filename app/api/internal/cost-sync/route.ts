import { NextRequest, NextResponse } from "next/server";
import {
  isBearerSecretAuthorized,
  isCostSyncNonProdAllowed,
  isCostsEnabled,
  isProductionRuntime,
} from "@/lib/costs/config";
import { runCostSync } from "@/lib/costs/sync";
import { costSyncRequestSchema } from "@/lib/validations/costs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  let eventId: string | undefined;
  let projectId: string | undefined;
  let target: string | undefined;
  try {
    const parsed = costSyncRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    eventId = parsed.data.eventId;
    projectId = parsed.data.projectId;
    target = parsed.data.target;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const expectedProjectId = process.env.COST_VERCEL_PROJECT_ID;
  if (projectId && expectedProjectId && projectId !== expectedProjectId) {
    return NextResponse.json({ data: { status: "skipped" } });
  }
  if (target && target !== "production") {
    return NextResponse.json({ data: { status: "skipped" } });
  }

  const result = await runCostSync({
    trigger: "DEPLOYMENT",
    eventId: eventId ?? request.headers.get("x-vercel-id") ?? undefined,
  });
  return NextResponse.json({ data: result });
}
