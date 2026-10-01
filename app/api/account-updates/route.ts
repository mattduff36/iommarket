import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCurrentDealerEntitlement } from "@/lib/dealers/entitlement";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Return an opaque version, never other members' records or private event data. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const admin = new URL(request.url).searchParams.get("scope") === "admin";
  if (admin && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }
  const [listings, offers, membership, users] = await Promise.all([
    db.listing.aggregate({ where: admin ? {} : { userId: user.id }, _count: true, _max: { updatedAt: true } }),
    db.dealerUpgradeOffer.aggregate({ where: admin ? {} : { userId: user.id }, _count: true, _max: { updatedAt: true } }),
    admin ? db.subscription.aggregate({ _count: true, _max: { updatedAt: true } }) : getCurrentDealerEntitlement(user),
    admin ? db.user.aggregate({ _count: true, _max: { updatedAt: true } }) : null,
  ]);
  const version = createHash("sha256").update(JSON.stringify({
    user: { id: user.id, role: user.role, updatedAt: user.updatedAt, dealer: user.dealerProfile },
    listings, offers, membership, users,
  })).digest("hex");
  return NextResponse.json({ version }, { headers });
}
