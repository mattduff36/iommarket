import { describe, expect, it } from "vitest";
import { clientDiagnosticsSchema, photoGuardDiagnostics } from "@/lib/monitoring/client-diagnostics";
import { withUploadDiagnostic } from "@/lib/images/upload-client-error";
import { safeEventEvidence } from "@/scripts/fixerrors/evidence";

describe("photo failure evidence", () => {
  it.each([
    [{ uploading: true, recovering: false, needsAttention: false }, "uploading"],
    [{ uploading: false, recovering: true, needsAttention: false }, "recovering"],
    [{ uploading: false, recovering: false, needsAttention: true }, "needs-attention"],
    [{ uploading: false, recovering: false, needsAttention: false }, "ready"],
  ] as const)("distinguishes real guard states (%#)", (state, expected) => {
    expect(photoGuardDiagnostics({ ...state, photoCount: 3 }).photoState).toBe(expected);
  });
  it("bounds counts and rejects arbitrary data rather than storing it", () => {
    const diagnostics = photoGuardDiagnostics({ uploading: true, recovering: true, needsAttention: true, photoCount: 999 });
    expect(diagnostics.photoCount).toBe(100);
    expect(clientDiagnosticsSchema.safeParse({ ...diagnostics, fileName: "private.jpg" }).success).toBe(false);
    expect(clientDiagnosticsSchema.safeParse({ photoCount: -1 }).success).toBe(false);
    expect(clientDiagnosticsSchema.safeParse({ imagePhase: "https://private.test" }).success).toBe(false);
  });
  it("preserves an observed status and ephemeral correlation through export, not the response body or URL", () => {
    const response = new Response("private body", { status: 503, headers: { "x-request-id": "request_12345678" } });
    const error = withUploadDiagnostic(new TypeError("private URL?secret=value"), "finalize", response);
    expect(error.diagnostics).toEqual({ operation: "photo-upload", imagePhase: "finalize", httpStatus: 503, imageRequestId: "request_12345678" });
    const evidence = safeEventEvidence({ diagnostics: { ...error.diagnostics, url: "private", body: "private" } });
    expect(evidence).toMatchObject({ operation: "photo-upload", imagePhase: "finalize",
      httpStatus: 503, imageRequestId: "request_12345678" });
    expect(JSON.stringify(evidence)).not.toMatch(/private|secret|url|body/);
  });
  it("keeps unknown status absent and never classifies it as noise", () => {
    const error = withUploadDiagnostic(new TypeError("Load failed"), "provider-upload");
    expect(error.diagnostics).toEqual({ operation: "photo-upload", imagePhase: "provider-upload" });
    expect(error.code).toBe("unavailable");
    expect(safeEventEvidence({ diagnostics: { imagePhase: "provider-upload", httpStatus: 0 } })).not.toHaveProperty("httpStatus");
  });
});
