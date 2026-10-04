import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { getMarketplaceDealerWhereWithSettings } from "@/lib/dealers/access";
import { renderDealerSocialImage } from "@/lib/images/dealer-social";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(slug)) return new Response(null, { status: 404 });
  const limit = await checkRateLimit(`dealer-social:${slug}`, { maxRequests: 60, windowMs: 60_000 });
  if (!limit.allowed) return new Response(null, { status: limit.unavailable ? 503 : 429, headers: { "Retry-After": "60" } });
  const dealer = await db.dealerProfile.findFirst({
    where: { AND: [{ slug, isAdminPreview: false }, await getMarketplaceDealerWhereWithSettings(null)] },
    select: { name: true, logoUrl: true },
  });
  if (!dealer) return new Response(null, { status: 404 });
  let bytes: ArrayBuffer | Uint8Array;
  try {
    if (!dealer.logoUrl) throw new Error("No dealer logo.");
    bytes = await renderDealerSocialImage(dealer.name, dealer.logoUrl);
  } catch {
    // Missing, unsupported or unavailable logos must never break a share preview.
    bytes = new Uint8Array(await readFile(join(process.cwd(), "public/og/itrader-social.png")));
  }
  return new Response(bytes as BodyInit, { headers: {
    "Content-Type": "image/png", "Cache-Control": "public, max-age=300, s-maxage=300",
    "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex",
  } });
}
