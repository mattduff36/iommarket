import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * POST /api/dev-auth
 * Validates the dev password and sets a session cookie.
 */
export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    const devPass = process.env.DEV_PASS;

    if (!devPass || typeof password !== "string") {
      return NextResponse.json(
        { error: "Not configured" },
        { status: 500 },
      );
    }

    // Constant-time comparison to prevent timing attacks
    const encoder = new TextEncoder();
    const a = encoder.encode(password);
    const b = encoder.encode(devPass);

    const isMatch =
      a.byteLength === b.byteLength && timingSafeEqual(a, b);

    if (!isMatch) {
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
