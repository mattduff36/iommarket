import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { requiresStagingAdmin } from "@/lib/deployment/staging-access-policy";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      role: user.role,
      stagingFeaturesEnabled: user.role === "ADMIN" && isStagingOnlyFeatureEnabled(),
      stagingAccessAllowed: requiresStagingAdmin() && user.stagingAccessAllowed,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
