import { NextResponse } from "next/server";
import { isStagingDeployment } from "@/lib/deployment/environment";
import { publicMirrorError } from "@/lib/preview-mirror/error";
import { authorizeScheduledRequest } from "@/lib/preview-mirror/guards";
import { refreshPreviewMirror } from "@/lib/preview-mirror/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isStagingDeployment()) return NextResponse.json({ error: "Unavailable." }, { status: 404 });
  if (!authorizeScheduledRequest(
    request.headers.get("x-preview-mirror-signature"),
    request.headers.get("x-preview-mirror-timestamp"),
    process.env.PREVIEW_MIRROR_CRON_SECRET,
  )) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await refreshPreviewMirror({ trigger: "automatic" });
    return NextResponse.json(result, { status: result.status === "busy" ? 409 : 200 });
  } catch (error) {
    return NextResponse.json({ error: publicMirrorError(error) }, { status: 500 });
  }
}
