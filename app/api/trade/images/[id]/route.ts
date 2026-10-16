import { NextResponse } from "next/server";
import { readAuthorizedTradePhoto } from "@/lib/trade-exchange/images";
import { loadTradeSession } from "@/lib/trade-exchange/session";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await loadTradeSession();
  const { id } = await context.params;
  const photo = await readAuthorizedTradePhoto(session.actor, id);
  if (!photo) return new NextResponse(null, { status: 404, headers });
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: { ...headers, "Content-Type": photo.contentType },
  });
}
