import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { hasDealerDashboardAccess } from "@/lib/dealers/access";
import { getCurrentDealerEntitlement } from "@/lib/dealers/entitlement";
import { db } from "@/lib/db";
import { captureException } from "@/lib/monitoring";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createDealerLogoStoragePath,
  DEALER_LOGO_BUCKET,
  getOwnedDealerLogoStoragePath,
  validateDealerLogoFile,
} from "@/lib/upload/dealer-logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasTrustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === request.nextUrl.origin;
}

async function getAuthorizedDealer() {
  try {
    const user = await requireAuth();
    if (!hasDealerDashboardAccess(user)) return null;
    if (!(await getCurrentDealerEntitlement(user))) return null;
    return user;
  } catch {
    return null;
  }
}

function getOwnedLogoPath(
  logoUrl: string | null,
  authUserId: string,
  dealerId: string,
) {
  return getOwnedDealerLogoStoragePath({
    logoUrl,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    authUserId,
    dealerId,
  });
}

async function removeOwnedLogo({
  path,
  userId,
  action,
}: {
  path: string | null;
  userId: string;
  action: "replaceDealerLogo" | "removeDealerLogo";
}) {
  if (!path) return;

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.storage.from(DEALER_LOGO_BUCKET).remove([path]);
    if (error) throw error;
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action,
      route: "/api/dealer-profile/logo",
      requestPath: "/api/dealer-profile/logo",
      userId,
      tags: { storagePath: path },
    });
  }
}

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getAuthorizedDealer();
  if (!user) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const rate = checkRateLimit(
    makeRateLimitKey("dealer-logo-upload", user.id),
    { windowMs: 60_000, maxRequests: 10 },
  );
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many upload attempts. Try again shortly." }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload data" }, { status: 400 });
  }

  const logo = formData.get("logo");
  if (!logo || typeof logo === "string") {
    return NextResponse.json({ error: "Choose an image file to upload." }, { status: 400 });
  }

  const validatedLogo = await validateDealerLogoFile(logo);
  if ("error" in validatedLogo) {
    return NextResponse.json({ error: validatedLogo.error }, { status: 400 });
  }

  const previousLogoUrl = user.dealerProfile.logoUrl;
  const storagePath = createDealerLogoStoragePath({
    authUserId: user.authUserId,
    dealerId: user.dealerProfile.id,
    extension: validatedLogo.data.extension,
    objectId: randomUUID(),
  });

  try {
    const supabase = createSupabaseAdminClient();
    const { error: uploadError } = await supabase.storage
      .from(DEALER_LOGO_BUCKET)
      .upload(storagePath, validatedLogo.data.bytes, {
        contentType: validatedLogo.data.mimeType,
        cacheControl: "31536000",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from(DEALER_LOGO_BUCKET)
      .getPublicUrl(storagePath);
    const logoUrl = publicUrlData.publicUrl;

    try {
      await db.dealerProfile.update({
        where: { id: user.dealerProfile.id },
        data: { logoUrl },
      });
    } catch (error) {
      await supabase.storage.from(DEALER_LOGO_BUCKET).remove([storagePath]);
      throw error;
    }

    await removeOwnedLogo({
      path: getOwnedLogoPath(
        previousLogoUrl,
        user.authUserId,
        user.dealerProfile.id,
      ),
      userId: user.id,
      action: "replaceDealerLogo",
    });

    return NextResponse.json(
      { data: { logoUrl } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "uploadDealerLogo",
      route: "/api/dealer-profile/logo",
      requestPath: "/api/dealer-profile/logo",
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Could not upload your logo. Please try again." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getAuthorizedDealer();
  if (!user) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const rate = checkRateLimit(
    makeRateLimitKey("dealer-logo-remove", user.id),
    { windowMs: 60_000, maxRequests: 10 },
  );
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many removal attempts. Try again shortly." }, { status: 429 });
  }

  const previousLogoUrl = user.dealerProfile.logoUrl;

  try {
    await db.dealerProfile.update({
      where: { id: user.dealerProfile.id },
      data: { logoUrl: null },
    });

    await removeOwnedLogo({
      path: getOwnedLogoPath(
        previousLogoUrl,
        user.authUserId,
        user.dealerProfile.id,
      ),
      userId: user.id,
      action: "removeDealerLogo",
    });

    return NextResponse.json(
      { data: { logoUrl: null } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "removeDealerLogo",
      route: "/api/dealer-profile/logo",
      requestPath: "/api/dealer-profile/logo",
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Could not remove your logo. Please try again." },
      { status: 500 },
    );
  }
}
