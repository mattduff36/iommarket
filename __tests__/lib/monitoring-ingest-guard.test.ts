import { describe, expect, it } from "vitest";
import { assessClientIngest, shouldSampleClientEvent } from "@/lib/monitoring/ingest-guard";

describe("client monitoring ingest guard", () => {
  it("rejects a foreign origin and high-cardinality noise", () => {
    expect(assessClientIngest({
      origin: "https://evil.example",
      host: "itrader.im",
      contentType: "application/json",
      message: "boom",
      severity: "MEDIUM",
    })).toMatchObject({ ok: false, status: 403 });

    expect(assessClientIngest({
      origin: null,
      host: "itrader.im",
      contentType: "application/json",
      message: "a 11111111 b 22222222 c 33333333 d 44444444",
      severity: "MEDIUM",
    })).toMatchObject({ ok: false, status: 400 });
  });

  it("samples only one tenth of low-severity messages", () => {
    const messages = Array.from({ length: 100 }, (_, index) => `minor ${index}`);
    const kept = messages.filter((message) => shouldSampleClientEvent(message, "LOW"));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(30);
    expect(shouldSampleClientEvent("anything", "HIGH")).toBe(true);
  });
});
