import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ user: vi.fn(), rate: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.rate, makeRateLimitKey: (a: string, b: string) => `${a}:${b}` }));
vi.mock("@/lib/monitoring", () => ({ captureBusinessEvent: m.capture }));
import { POST } from "@/app/api/monitoring/report-issue/route";
const payload = { reportId: "6d4267c4-0ab8-4403-b0cd-bf79a62c9fb2", message: "We could not verify this photo.", route: "/sell/private" };
function request(body: unknown = payload, origin = "https://itrader.im") {
  return new NextRequest("https://itrader.im/api/monitoring/report-issue", { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": "203.0.113.1" }, body: JSON.stringify(body) });
}
describe("explicit user issue reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.user.mockResolvedValue({ id: "user-1", email: "private@example.com" });
    m.rate.mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now()+60_000, unavailable: false });
    m.capture.mockResolvedValue({ eventId: "event_123456", issueId: "issue_123456" });
  });
  it("records a real monitoring issue using trusted account identity and a stable dedupe key", async () => {
    const first = await POST(request());
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ ok: true, reference: "event_123456" });
    expect(m.capture).toHaveBeenCalledWith(expect.objectContaining({ source: "CLIENT", action: "user-report-issue", severity: "MEDIUM", userId: "user-1", message: payload.message }));
    const key = m.capture.mock.calls[0][0].dedupeKey;
    await POST(request());
    expect(m.capture.mock.calls[1][0].dedupeKey).toBe(key);
  });
  it("accepts reports from signed-out error screens and redacts secrets/query strings", async () => {
    m.user.mockResolvedValue(null);
    await POST(request({ ...payload, message: "Failed for person@example.com using https://example.com/x?token=secret", route: "/sign-in?token=secret#fragment" }));
    const captured = m.capture.mock.calls[0][0];
    expect(captured.route).toBe("/sign-in");
    expect(JSON.stringify(captured)).not.toContain("secret");
    expect(JSON.stringify(captured)).not.toContain("person@example.com");
    expect(captured.userId).toBeUndefined();
  });
  it("never claims success when monitoring storage fails", async () => {
    m.capture.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
  });
  it("rejects cross-origin, excessive, and malformed requests without recording them", async () => {
    expect((await POST(request(payload, "https://attacker.example"))).status).toBe(403);
    expect((await POST(request({ ...payload, severity: "CRITICAL", userId: "other" }))).status).toBe(400);
    expect((await POST(request({ ...payload, message: "x".repeat(9000) }))).status).toBe(413);
    m.rate.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now()+60_000, unavailable: false });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(m.capture).not.toHaveBeenCalled();
  });
});

it("rejects missing origin, unsupported content type and unsafe paths", async () => {
  m.capture.mockClear();
  const missingOrigin = request(); missingOrigin.headers.delete("origin");
  expect((await POST(missingOrigin)).status).toBe(403);
  const nonJson = request(); nonJson.headers.set("content-type", "application/json-invalid");
  expect((await POST(nonJson)).status).toBe(415);
  for (const route of ["https://external.example/path", "//external.example/path", "/bad\\path"]) {
    expect((await POST(request({ ...payload, route }))).status).toBe(400);
  }
  expect(m.capture).not.toHaveBeenCalled();
});

it("excludes reporting-endpoint failures from recursive automatic monitoring", async () => {
  const { isMonitoringIngestPath } = await import("@/lib/monitoring/redact");
  expect(isMonitoringIngestPath("/api/monitoring/report-issue?retry=1")).toBe(true);
  expect(isMonitoringIngestPath("/sell")).toBe(false);
});
