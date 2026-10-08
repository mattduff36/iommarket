import { readUploadJson } from "@/lib/media/upload-request";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { acceptedAuthHttpStatus, requireAcceptedAuth } from "@/lib/policy/gate";
import { finalizeManagedImageKitUpload } from "@/lib/media/managed-upload";
import { publicImageVerificationError } from "@/lib/media/verification-error";
import { imageRecordFromIntent } from "@/lib/media/stored-image";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { toRateLimitDenial } from "@/lib/rate-limit-result";
import { ADMIN_OWNED_LISTING_ERROR, isAdminSellerBlocked } from "@/lib/listings/seller-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const requestSchema = z.object({
  uploadIntentId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  fileId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export async function POST(request: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "Invalid request origin." }, 403);
  if (process.env.IMAGEKIT_UPLOADS_ENABLED !== "1") return reply({ error: "Managed ImageKit uploads are disabled." }, 404);
  let user;
  try { user = await requireAcceptedAuth(); }
  catch (error) { return reply({ error: "Not authorized." }, acceptedAuthHttpStatus(error)); }
  if (isAdminSellerBlocked(user.role)) return reply({ error: ADMIN_OWNED_LISTING_ERROR }, 403);
  const denial = toRateLimitDenial(await checkRateLimit(makeRateLimitKey("imagekit-finalize", user.id), {
    windowMs: 60_000, maxRequests: 10, policy: "listing-image-imagekit",
  }), "Too many upload verification attempts.");
  if (denial) return NextResponse.json({ error: denial.message }, { status: denial.status,
    headers: { "Cache-Control": "no-store", "Retry-After": String(denial.retryAfterSeconds) } });
  const parsed = requestSchema.safeParse(await readUploadJson(request).catch(() => null));
  if (!parsed.success) return reply({ error: "Invalid upload request." }, 400);
  try {
    const intent = await finalizeManagedImageKitUpload({ userId: user.id, intentId: parsed.data.uploadIntentId, fileId: parsed.data.fileId });
    const stored = imageRecordFromIntent(intent);
    return reply({ data: {
      ...stored, uploadIntentId: intent.id, version: intent.version,
      width: intent.width, height: intent.height, format: intent.format, bytes: intent.bytes,
    } });
  } catch (error) {
    // Provider errors can contain private paths. Never echo raw provider responses or signed URLs.
    return reply({ error: publicImageVerificationError(error) }, 400);
  }
}
