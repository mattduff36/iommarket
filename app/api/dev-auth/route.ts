import { NextResponse, type NextRequest } from "next/server";
import { decideDevAuth } from "@/lib/dev-auth";

/**
 * POST /api/dev-auth
 * Validates the dev password and sets a session cookie.
 * PREVIEW_PASS returns a redirect URL instead of unlocking this site.
 */
export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    const decision = decideDevAuth(password, {
      devPass: process.env.DEV_PASS,
      previewPass: process.env.PREVIEW_PASS,
      previewUrl: process.env.PREVIEW_URL,
    });

    if (decision.kind === "not_configured") {
      return NextResponse.json(
        { error: "Not configured" },
        { status: 500 },
      );
    }

    if (decision.kind === "preview") {
      return NextResponse.json({
        success: true,
        redirect: decision.redirect,
      });
    }

    if (decision.kind === "unauthorized") {
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401 },
      );
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set("dev-auth", "true", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "Bad request" },
      { status: 400 },
    );
  }
}
