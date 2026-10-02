import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { captureException } from "@/lib/monitoring";
import { assessClientIngest } from "@/lib/monitoring/ingest-guard";
import { capClientIngestSeverity, coerceSeverity } from "@/lib/monitoring/severity";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { toRateLimitDenial } from "@/lib/rate-limit-result";
import { ingestMonitoringClientEventSchema } from "@/lib/validations/monitoring";

const MAX_BODY_BYTES = 64_000;

function hashIp(ip: string | null): string | undefined {
  if (!ip) return undefined;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ingestMonitoringClientEventSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const severity = coerceSeverity(capClientIngestSeverity(parsed.data.severity), "CLIENT");
  const assessment = assessClientIngest({
    origin: req.headers.get("origin"),
    host: req.headers.get("host"),
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    contentType: req.headers.get("content-type"),
    message: parsed.data.message,
    route: parsed.data.route,
    severity,
  });
  if (!assessment.ok) {
    return NextResponse.json({ error: assessment.error }, { status: assessment.status });
  }
  if (!assessment.sampled) {
    return NextResponse.json({ ok: true, accepted: false }, { status: 202 });
  }

  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
  const userAgent = req.headers.get("user-agent") ?? "unknown";

  const identity = `${ip ?? "unknown"}:${userAgent}`;
  const fingerprintKey = createHash("sha256")
    .update(`${parsed.data.route ?? ""}|${parsed.data.message.slice(0, 180)}`)
    .digest("hex")
    .slice(0, 16);
  const clientLimit = await checkRateLimit(
    makeRateLimitKey("monitoring-client", identity),
    { windowMs: 60_000, maxRequests: 20, policy: "monitoring-client" },
  );
  const globalLimit = await checkRateLimit(
    makeRateLimitKey("monitoring-client-global", "all"),
    { windowMs: 60_000, maxRequests: 300, policy: "monitoring-client-global" },
  );
  const fingerprintLimit = await checkRateLimit(
    makeRateLimitKey("monitoring-client-fingerprint", `${identity}:${fingerprintKey}`),
    { windowMs: 60_000, maxRequests: 5, policy: "monitoring-client-fingerprint" },
  );
  const rateDenial = toRateLimitDenial(
    [clientLimit, globalLimit, fingerprintLimit].find((result) => !result.allowed) ?? clientLimit,
    "Rate limit exceeded",
  );
  if (rateDenial) {
    return NextResponse.json(
      { error: rateDenial.message },
      { status: rateDenial.status, headers: { "Retry-After": String(rateDenial.retryAfterSeconds) } },
    );
  }

  const user = await getCurrentUser();

  const err = new Error(parsed.data.message);
  if (parsed.data.stack) {
    err.stack = parsed.data.stack;
  }

  const result = await captureException({
    source: "CLIENT",
    error: err,
    severity: capClientIngestSeverity(parsed.data.severity),
    route: parsed.data.route,
    requestPath: parsed.data.route,
    component: parsed.data.component,
    requestId: parsed.data.requestId,
    userId: user?.id,
    userEmail: user?.email,
    ipHash: hashIp(ip),
    tags: {
      ...parsed.data.tags,
      userAgent,
    },
    extra: parsed.data.extra,
  });

  return NextResponse.json(
    { ok: true, issueId: result?.issueId ?? null, eventId: result?.eventId ?? null },
    { status: 202 }
  );
}
