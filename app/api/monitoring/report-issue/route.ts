import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { captureBusinessEvent } from "@/lib/monitoring";
import { cleanReportedMessage } from "@/lib/monitoring/user-report";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { toRateLimitDenial } from "@/lib/rate-limit-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  reportId: z.uuid(),
  message: z.string().trim().min(3).max(2000),
  route: z.string().max(500).refine(value => value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f]/.test(value)),
  supportReference: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional(),
}).strict();
const MAX_BYTES = 8192;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function readBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return null; }
      parts.push(part.value);
    }
    return Buffer.concat(parts).toString("utf8");
  } finally { reader.releaseLock(); }
}

export async function POST(request: NextRequest) {
  const reply = (body: unknown, status: number, headers: Record<string, string> = {}) =>
    NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
  // Explicit clicks use same-origin JSON, including on signed-out error screens.
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply({ ok: false }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return reply({ ok: false }, 415);
  const raw = await readBody(request).catch(() => "");
  if (raw === null) return reply({ ok: false }, 413);
  const parsed = schema.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!parsed.success) return reply({ ok: false }, 400);

  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
    const ipHash = hash(ip);
    const limits = await Promise.all([
      checkRateLimit(makeRateLimitKey("issue-report", ipHash), { windowMs: 10 * 60_000, maxRequests: 10, policy: "issue-report" }),
      checkRateLimit(makeRateLimitKey("issue-report-global", "all"), { windowMs: 60_000, maxRequests: 100, policy: "issue-report-global" }),
    ]);
    const denied = limits.find(result => !result.allowed);
    const denial = denied && toRateLimitDenial(denied, "Please wait before reporting another issue.");
    if (denial) return reply({ ok: false }, denial.status, { "Retry-After": String(denial.retryAfterSeconds) });
    const user = await getCurrentUser().catch(() => null);
    // Keep changing support IDs out of the issue fingerprint; preserve the reference separately.
    const message = cleanReportedMessage(parsed.data.message).replace(/\breference [A-Za-z0-9_-]{8,80}\b/g, "reference [recorded]");
    const route = parsed.data.route.split(/[?#]/)[0];
    const captured = await captureBusinessEvent({
      source: "CLIENT", severity: "MEDIUM", action: "user-report-issue",
      title: `User-reported issue: ${message.slice(0, 140)}`, message, route, requestPath: route,
      dedupeKey: `user-report:${hash(`${user?.id ?? ipHash}:${parsed.data.reportId}`)}`,
      userId: user?.id, ipHash,
      tags: { type: "user-reported", userAgent: (request.headers.get("user-agent") ?? "unknown").slice(0, 300) },
      extra: { displayedSupportReference: parsed.data.supportReference ?? null },
    });
    if (!captured?.eventId) return reply({ ok: false }, 503);
    return reply({ ok: true, reference: captured.eventId }, 201);
  } catch {
    // A reporting outage must never be reported recursively or claim successful delivery.
    return reply({ ok: false }, 503);
  }
}
