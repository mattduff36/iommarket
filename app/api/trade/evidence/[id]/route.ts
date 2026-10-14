import { NextResponse } from "next/server";
import { readTradeEvidence } from "@/lib/trade-exchange/evidence";
import { loadTradeSession } from "@/lib/trade-exchange/session";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await loadTradeSession();
  if (session.actor.kind !== "admin") return new NextResponse(null, { status: 404, headers });
  const { id } = await context.params;
  const evidence = await readTradeEvidence(session.actor.userId, id);
  if (!evidence) return new NextResponse(null, { status: 404, headers });
  return new NextResponse(new Uint8Array(evidence.bytes), {
    headers: {
      ...headers,
      "Content-Type": evidence.contentType,
      "Content-Disposition": `attachment; filename="${evidence.fileName}"`,
    },
  });
}
