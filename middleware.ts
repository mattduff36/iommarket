import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware that uses Clerk when configured, otherwise passes through.
 * This lets the app run in dev without Clerk credentials.
 */
export default async function middleware(request: NextRequest) {
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
    "/styleguide(.*)",
    "/api/webhooks(.*)",
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
