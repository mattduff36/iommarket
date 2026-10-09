"use server";

import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { refreshPreviewMirror, readMirrorStatus } from "@/lib/preview-mirror/engine";
import { publicMirrorError } from "@/lib/preview-mirror/error";
import { stagingMutationOriginAllowed } from "@/lib/preview-mirror/guards";

const unavailable = "Preview refresh is available only on the verified staging deployment.";
type MirrorStatus = Awaited<ReturnType<typeof readMirrorStatus>>;

export async function loadPreviewMirrorStatus(): Promise<{ error: string; data?: never } | { data: MirrorStatus; error?: never }> {
  await requireRole("ADMIN");
  if (!isStagingOnlyFeatureEnabled()) return { error: unavailable };
  try { return { data: await readMirrorStatus() }; }
  catch (error) { return { error: publicMirrorError(error) }; }
}

export async function refreshPreviewMirrorAction() {
  const admin = await requireRole("ADMIN");
  if (!isStagingOnlyFeatureEnabled()) return { error: unavailable };
  const origin = (await headers()).get("origin");
  if (!stagingMutationOriginAllowed(origin, process.env)) return { error: "Open this page on staging and try again." };
  try {
    const result = await refreshPreviewMirror({ trigger: "manual", actorId: admin.id });
    return { data: result };
  } catch (error) { return { error: publicMirrorError(error) }; }
}
