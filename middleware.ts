import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware that:
 * 1. Gates the entire site behind a dev password (cookie-based session).
 *    Public visitors only see the holding page at "/".
 * 2. Uses Clerk auth for authenticated dev users (when configured).
 */
export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /* ------------------------------------------------------------------ */
  /*  1. Always allow API routes (webhooks, dev-auth, etc.)              */
  /* ------------------------------------------------------------------ */
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  /* ------------------------------------------------------------------ */
  /*  2. Always allow the dev auth page; redirect /dev → /dev/auth       */
  /* ------------------------------------------------------------------ */
  if (pathname === "/dev") {
    return NextResponse.redirect(new URL("/dev/auth", request.url));
  }
  if (pathname === "/dev/auth") {
    return NextResponse.next();
  }

  /* ------------------------------------------------------------------ */
  /*  3. Block direct access to /holding (only reachable via rewrite)    */
  /* ------------------------------------------------------------------ */
  if (pathname === "/holding") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  /* ------------------------------------------------------------------ */
  /*  4. Check dev-auth session cookie                                   */
  /* ------------------------------------------------------------------ */
  const devAuth = request.cookies.get("dev-auth")?.value === "true";

  if (!devAuth) {
    // Unauthenticated visitors: show holding page at "/" only
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/holding", request.url));
    }
    // All other paths → redirect to holding page
    return NextResponse.redirect(new URL("/", request.url));
  }

  /* ------------------------------------------------------------------ */
  /*  5. Authenticated dev user → apply Clerk middleware if configured    */
  /* ------------------------------------------------------------------ */
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const hasValidKey = key && /^pk_(test|live)_[A-Za-z0-9]{20,}/.test(key);

  if (!hasValidKey) {
    // No Clerk configured — pass through without auth checks
    return NextResponse.next();
  }

  // Dynamically import Clerk middleware only when configured
  const { clerkMiddleware, createRouteMatcher } = await import(
    "@clerk/nextjs/server"
  );

  const isPublicRoute = createRouteMatcher([
    "/",
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/categories(.*)",
    "/listings(.*)",
    "/search(.*)",
    "/pricing(.*)",
    "/dealers(.*)",
    "/uidemo(.*)",
    "/api/webhooks(.*)",
    "/dev/auth",
  ]);

  const handler = clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
  });

  return handler(request, {} as never);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
