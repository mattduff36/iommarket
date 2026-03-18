import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { captureException } from "@/lib/monitoring";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
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

  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
  const userAgent = req.headers.get("user-agent") ?? "unknown";

  const rate = checkRateLimit(
    makeRateLimitKey("monitoring-client", `${ip ?? "unknown"}:${userAgent}`),
    { windowMs: 60_000, maxRequests: 20 }
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 }
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
    severity: parsed.data.severity,
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
