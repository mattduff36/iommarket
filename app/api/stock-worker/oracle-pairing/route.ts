import { oracleDeployment, oracleProfiles, profileForBearer } from "@/lib/dealer-stock-sync/oracle-pairing-config";
import { oracleMessageSchema, oraclePairingStore } from "@/lib/dealer-stock-sync/oracle-pairing";
import { readBoundedBody } from "@/lib/costs/accounts-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(status: number, body: object) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff",
  } });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const deployment = oracleDeployment(process.env);
  if (!deployment || url.origin !== deployment.origin || url.search) return reply(404, { error: "unavailable" });
  const profile = profileForBearer(oracleProfiles(process.env, deployment), request.headers.get("authorization"));
  if (!profile) return reply(401, { error: "unauthorized" });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return reply(400, { error: "invalid_request" });
  }
  let body: unknown;
  try {
    const text = await readBoundedBody(new Response(request.body, { headers: request.headers }), 512);
    if (!text) return reply(400, { error: "invalid_request" });
    body = JSON.parse(text);
  } catch { return reply(400, { error: "invalid_request" }); }
  const message = oracleMessageSchema.safeParse(body);
  if (!message.success) return reply(400, { error: "invalid_request" });
  try {
    const result = await oraclePairingStore(profile).agent(message.data);
    return result.ok ? reply(200, result) : reply(409, { error: "expired_request" });
  } catch { return reply(503, { error: "unavailable" }); }
}
