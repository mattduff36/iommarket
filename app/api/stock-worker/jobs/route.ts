import { handleDesktopJob } from "@/lib/dealer-stock-sync/desktop-jobs";
import { createDesktopJobDependencies } from "@/lib/dealer-stock-sync/desktop-job-executor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 2 * 1024 * 1024;

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

function json(status: number, body: unknown, extra?: HeadersInit): Response {
  return Response.json(body, { status, headers: { ...RESPONSE_HEADERS, ...extra } });
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES || Number(declared) === 0)) {
    return null;
  }
  const stream = request.body;
  if (!stream) return null;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  if (total === 0) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.search) return json(400, { error: "invalid_request" });
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return json(400, { error: "invalid_request" });
  const text = await readBoundedBody(request);
  if (!text) return json(400, { error: "invalid_request" });
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return json(400, { error: "invalid_request" });
  }
  try {
    const result = await handleDesktopJob(createDesktopJobDependencies(), {
      body,
      authorization: request.headers.get("authorization"),
    });
    return json(result.status, result.ok ? result.body : { error: result.error });
  } catch {
    return json(503, { error: "unavailable" });
  }
}

export function GET(): Response {
  return json(405, { error: "invalid_request" }, { Allow: "POST" });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 405, headers: { ...RESPONSE_HEADERS, Allow: "POST" } });
}