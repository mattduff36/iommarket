import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function isPublicPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/sign-in" || pathname === "/sign-up" || pathname === "/forgot-password" || pathname === "/auth/callback" || pathname === "/dev/auth") return true;
  if (pathname.startsWith("/categories") || pathname.startsWith("/listings") || pathname.startsWith("/search") || pathname.startsWith("/pricing") || pathname.startsWith("/dealers") || pathname.startsWith("/uidemo")) return true;
  return false;
}

/**
 * Middleware that:
 * 1. Gates the entire site behind a dev password (cookie-based session).
 *    Public visitors only see the holding page at "/".
 * 2. Uses Supabase Auth for authenticated dev users (when configured).
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
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/holding", request.url));
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  /* ------------------------------------------------------------------ */
  /*  5. Authenticated dev user → Supabase session refresh + route guard  */
  /* ------------------------------------------------------------------ */
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
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

  if (!user && !isPublicPath(pathname)) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
