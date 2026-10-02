import { describe, expect, it } from "vitest";
import {
  signMonitoringWebhook,
  validateMonitoringWebhookUrl,
  verifyMonitoringWebhookSignature,
} from "@/lib/monitoring/webhook-security";

describe("monitoring webhook security", () => {
  it("rejects private and unsigned destinations", async () => {
    await expect(validateMonitoringWebhookUrl("http://alerts.example", {
      lookup: async () => ["1.1.1.1"],
    })).resolves.toMatchObject({ ok: false });

    await expect(validateMonitoringWebhookUrl("https://alerts.example", {
      lookup: async () => ["10.0.0.8"],
    })).resolves.toMatchObject({ ok: false });

    await expect(validateMonitoringWebhookUrl("https://alerts.example/hook", {
      lookup: async () => ["1.1.1.1"],
    })).resolves.toMatchObject({ ok: true });
  });

  it("verifies the timestamped HMAC", () => {
    const signature = signMonitoringWebhook("secret", 100, "{\"ok\":true}");
    expect(verifyMonitoringWebhookSignature("secret", 100, "{\"ok\":true}", signature)).toBe(true);
    expect(verifyMonitoringWebhookSignature("secret", 100, "{\"ok\":false}", signature)).toBe(false);
  });
});
