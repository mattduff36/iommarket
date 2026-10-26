import { requireRole } from "@/lib/auth";
import { desktopAccountEnabled } from "@/lib/dealer-stock-sync/desktop-config";
import { authoriseDesktopRequest, liveDesktopDependencies } from "@/lib/dealer-stock-sync/desktop-service";
import { getUpdateRelease } from "@/lib/dealer-stock-sync/update-release";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const fail = (status: number) => Response.json({ error: status === 401 ? "unauthorized" : "unavailable" }, { status, headers });

export async function POST(request: Request) {
  if (!isStagingOnlyFeatureEnabled()) return fail(404);
  if (new URL(request.url).search) return fail(400);
  try {
    const deps = liveDesktopDependencies();
    const auth = await authoriseDesktopRequest(deps, request.headers.get("authorization"));
    if (!auth.ok) return fail(auth.status);
    if (auth.principal.environment !== "preview") return fail(403);
    if (!await deps.store.consumeRate(`update:${auth.principal.deviceId}`, 12, 60)) return fail(429);
    return Response.json(await getUpdateRelease(), { headers });
  } catch { return fail(503); }
}

export async function GET(request: Request) {
  if (!isStagingOnlyFeatureEnabled()) return fail(404);
  if (new URL(request.url).search) return fail(400);
  let admin;
  try { admin = await requireRole("ADMIN"); } catch { return fail(401); }
  if (!desktopAccountEnabled(process.env, admin.id)) return fail(403);
  try {
    if (!await liveDesktopDependencies().store.consumeRate(`download:${admin.id}`, 12, 60)) return fail(429);
    const release = await getUpdateRelease();
    if (request.headers.get("accept") === "application/json") return Response.json({ downloadUrl: release.downloadUrl, version: release.version }, { headers });
    return new Response(null, { status: 302, headers: { ...headers, Location: release.downloadUrl } });
  } catch { return fail(503); }
}

