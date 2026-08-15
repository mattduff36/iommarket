import { NextRequest, NextResponse } from "next/server";
import { expireStaleLiveListings } from "@/lib/listings/expiry";
import { expireMutedMonitoringIssues } from "@/lib/monitoring/mute-expiry";
import { isCronAuthorized } from "@/lib/ops/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  return isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const expired = await expireStaleLiveListings({ force: true });
  const unmuted = await expireMutedMonitoringIssues();
  return NextResponse.json({ data: { expired, unmuted } });
}
