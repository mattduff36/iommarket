import { NextResponse } from "next/server";
import { isStagingDeployment } from "@/lib/deployment/environment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retired. Automatic preview refresh is manual-only and this route never starts the engine. */
export async function POST() {
  if (!isStagingDeployment()) return NextResponse.json({ error: "Unavailable." }, { status: 404 });
  return NextResponse.json({ error: "Automatic preview refresh is retired." }, { status: 410 });
}
