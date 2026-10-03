import { NextResponse, type NextRequest } from "next/server";
import { isPaymentReturnPath } from "@/lib/payments/return-routes";
import { CHECKOUT_ENVIRONMENT_COOKIE, stagingReturnDestination } from "@/lib/payments/staging-return-routing";
import { createServerClient } from "@supabase/ssr";
import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import { classifyLaunchRoute } from "@/lib/launch/route-class";
import {
  launchEnvironmentLabel,
  LAUNCH_GATE_COOKIE,
  verifyLaunchGateCookie,
} from "@/lib/launch/session";
import { resolvePreviewAccessPath } from "@/lib/preview-access";
import {
  hasConfirmedSupabaseSession,
  hasSupabaseAuthCookie,
} from "@/lib/launch/supabase-unlock";
import {
  isOnboardingSessionStale,
  readOnboardingSessionInvalidBefore,
} from "@/lib/dealers/onboarding/session-cutoff";
import { shouldBypassSupabaseSessionRefresh } from "@/lib/supabase/proxy-routing";
import { applyIndexingHeader } from "@/lib/seo/indexing-policy";
import { stagingAccessResponse } from "@/lib/deployment/staging-access";

export function isPublicPath(pathname: string): boolean {
  if (
    pathname === "/" ||
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname === "/forgot-password" ||
    pathname === "/auth/callback" ||
    pathname === "/early-access" ||
    pathname === "/preview" ||
    pathname.startsWith("/dealer/onboarding")
  ) {
    return true;
  }
  return (
    pathname.startsWith("/categories") ||
    pathname.startsWith("/listings") ||
    pathname.startsWith("/search") ||
    pathname.startsWith("/pricing") ||
    pathname.startsWith("/dealers") ||
    pathname.startsWith("/uidemo") ||
    pathname.startsWith("/vehicle-check") ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/cookies" ||
    pathname === "/dealer-terms" ||
    pathname === "/private-seller-terms" ||
    pathname === "/acceptable-use" ||
    pathname === "/refunds" ||
    pathname === "/vehicle-check-terms" ||
    pathname === "/contact" ||
    pathname === "/safety" ||
    pathname === "/faq" ||
    pathname === "/sell-on-the-isle-of-man" ||
    pathname === "/dealer-advertising"
  );
}

function hasValidLaunchSession(request: NextRequest): boolean {
  return verifyLaunchGateCookie(request.cookies.get(LAUNCH_GATE_COOKIE)?.value, {
    secret: process.env.DEV_GATE_SECRET,
    environment: launchEnvironmentLabel(),
  });
}

function launchGateResponse(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function gatedApiResponse(): NextResponse {
  return NextResponse.json(
    { error: "Service unavailable" },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "60",
      },
    },
  );
}

/**
 * Request proxy:
 * 1. Gates production and local runtimes until 10:00 BST on 3 October 2026.
 *    Vercel Preview stays open. A signed expiring cookie
 *    unlocks production without granting a Supabase identity.
 * 2. Refreshes Supabase sessions and guards private pages.
 */
async function routeProxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // A provider return must remain readable even if the login or launch cookie expired.
  // Rendering exposes no account data; return reconciliation authenticates separately.
  if (isPaymentReturnPath(pathname)) {
    const destination = stagingReturnDestination({
      url: request.nextUrl, method: request.method,
      requestHost: request.headers.get("host"),
      cookie: request.cookies.get(CHECKOUT_ENVIRONMENT_COOKIE)?.value,
    });
    if (destination) {
      const response = NextResponse.redirect(destination);
      response.headers.set("Cache-Control", "no-store");
      response.cookies.set(CHECKOUT_ENVIRONMENT_COOKIE, "", {
        domain: ".itrader.im", path: "/pay", secure: true, httpOnly: true,
        sameSite: "lax", maxAge: 0,
      });
      return response;
    }
    return NextResponse.next();
  }

  const previewAccess = resolvePreviewAccessPath(pathname);
  if (previewAccess?.action === "redirect") {
    return NextResponse.redirect(new URL(previewAccess.to, request.url));
  }
  if (previewAccess?.action === "allow") {
    return NextResponse.next();
  }

  if (pathname === "/holding") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const routeClass = classifyLaunchRoute(pathname);
  if (routeClass === "seo") {
    return NextResponse.next();
  }

  const gated = shouldEnforceLaunchGate();
  const launchUnlocked = hasValidLaunchSession(request);
  const sessionResponse = NextResponse.next({
    request: { headers: request.headers },
  });
  const sessionUnlocked =
    gated &&
    !launchUnlocked &&
    hasSupabaseAuthCookie(request) &&
    (await hasConfirmedSupabaseSession(request, sessionResponse));
  const unlocked = !gated || launchUnlocked || sessionUnlocked;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");

  if (isApi) {
    if (!unlocked && routeClass === "gated-api") return gatedApiResponse();
    if (sessionUnlocked) return sessionResponse;
    return NextResponse.next();
  }

  if (!unlocked) {
    if (routeClass === "homepage") {
      return launchGateResponse(NextResponse.rewrite(new URL("/holding", request.url)));
    }
    if (routeClass === "legal") {
      return NextResponse.next();
    }
    return launchGateResponse(NextResponse.redirect(new URL("/", request.url)));
  }

  if (sessionUnlocked) return sessionResponse;

  if (shouldBypassSupabaseSessionRefresh(pathname)) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.next();
  }

  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let sessionIsStale = false;
  if (user && readOnboardingSessionInvalidBefore(user.app_metadata) !== null) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    sessionIsStale = isOnboardingSessionStale(user.app_metadata, session?.access_token);
  }

  if ((!user || sessionIsStale) && !isPublicPath(pathname)) {
    const signUpUrl = new URL("/sign-up", request.url);
    signUpUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signUpUrl);
  }

  return response;
}

export async function proxy(request: NextRequest) {
  const staging = await stagingAccessResponse(request);
  if (staging) return applyIndexingHeader(staging, request.nextUrl.pathname);
  const response = await routeProxy(request);
  return applyIndexingHeader(response, request.nextUrl.pathname);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
