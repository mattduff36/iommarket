import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchUploadRequest } from "@/lib/images/upload-request-retry";
import { uploadErrorFromPayload } from "@/lib/images/upload-client-error";
import { PHOTO_UNKNOWN_MESSAGE } from "@/lib/media/upload-error-catalog";

describe("upload request recovery", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => { vi.useFakeTimers(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("preserves the limiter wait and safe retry classification", () => {
    const error = uploadErrorFromPayload({ error: "Too many upload verification attempts. Wait 60 seconds, then try again.", code: "rate_limited", retryable: true, retryAfterSeconds: 60 }, PHOTO_UNKNOWN_MESSAGE);
    expect(error).toMatchObject({ code: "rate_limited", retryable: true, retryAfterSeconds: 60 });
    expect(error.message).toContain("Wait 60 seconds");
    expect(uploadErrorFromPayload({ error: "Too many upload attempts. Wait 1 second, then try again.", code: "rate_limited" }, PHOTO_UNKNOWN_MESSAGE).code).toBe("rate_limited");
    expect(uploadErrorFromPayload({ error: "Too many upload attempts. Wait 60 seconds, then try again. token=secret", code: "rate_limited" }, PHOTO_UNKNOWN_MESSAGE).message).toBe(PHOTO_UNKNOWN_MESSAGE);
  });
  it("retries a rejected intent only after its wait without replaying ambiguous creation", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(Response.json({ data: "intent" }));
    const pending = fetchUploadRequest("/intent", { method: "POST" });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    await expect(fetchUploadRequest("/intent", { method: "POST" })).rejects.toThrow("network");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("bounds persistent failures and honours a wait exceeding its budget", async () => {
    fetchMock.mockImplementation(async () => Response.json({}, { status: 503 }));
    const pending = fetchUploadRequest("/finalize", {}, { verification: true });
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fetchMock.mockReset().mockResolvedValue(Response.json({}, { status: 429, headers: { "Retry-After": "600" } }));
    expect((await fetchUploadRequest("/finalize", {}, { verification: true })).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403, 404, 409])("does not retry terminal HTTP %i", async status => {
    fetchMock.mockResolvedValue(Response.json({}, { status }));
    expect((await fetchUploadRequest("/finalize", {}, { verification: true })).status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("honours explicit non-retryable failures", async () => {
    fetchMock.mockResolvedValue(Response.json({ retryable: false }, { status: 503 }));
    await fetchUploadRequest("/finalize", {}, { verification: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
