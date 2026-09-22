import { NextResponse, type NextRequest } from "next/server";
import { decideDevAuth } from "@/lib/dev-auth";
import {
  issueLaunchGateCookie,
  launchEnvironmentLabel,
  LAUNCH_GATE_COOKIE,
} from "@/lib/launch/session";
import { checkRateLimit, makeRateLimitKey, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { toRateLimitDenial } from "@/lib/rate-limit-result";

/**
 * POST /api/dev-auth
 * DEV_PASS creates a signed production gate session only.
 * PREVIEW_PASS redirects to the Vercel Preview URL and does not unlock production.
 * Neither password grants a Supabase identity.
 */
export async function POST(request: NextRequest) {
  try {
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
    const rate = await checkRateLimit(
      makeRateLimitKey("dev-auth", ip),
      RATE_LIMIT_POLICIES.devAuth,
    );
    const denial = toRateLimitDenial(rate, "Too many attempts. Try again later.");
    if (denial) {
      return NextResponse.json(
        { error: denial.message },
        {
          status: denial.status,
          headers: { "Retry-After": String(denial.retryAfterSeconds), "Cache-Control": "no-store" },
        },
      );
    }

    const { password } = await request.json();
    const decision = decideDevAuth(password, {
      devPass: process.env.DEV_PASS,
      previewPass: process.env.PREVIEW_PASS,
      previewUrl: process.env.PREVIEW_URL,
    });

    if (decision.kind === "not_configured") {
      return NextResponse.json({ error: "Not configured" }, { status: 500 });
    }

    if (decision.kind === "preview") {
      return NextResponse.json({
        success: true,
        redirect: decision.redirect,
      });
    }

    if (decision.kind === "unauthorized") {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const issued = issueLaunchGateCookie({
      secret: process.env.DEV_GATE_SECRET,
      environment: launchEnvironmentLabel(),
    });
    if (!issued) {
      return NextResponse.json({ error: "Not configured" }, { status: 500 });
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(LAUNCH_GATE_COOKIE, issued.value, issued.options);
    return response;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
