import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
const findIssue = vi.hoisted(() => vi.fn());
const findEvent = vi.hoisted(() => vi.fn());
const effects = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
const constructed = vi.hoisted(() => vi.fn());
const enqueue = vi.hoisted(() => vi.fn());
const processOutbox = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    adminAuditLog: { create },
    monitoringIssue: { findUnique: findIssue },
    monitoringEvent: { findUnique: findEvent },
  },
}));
vi.mock("@/lib/database-sync/effects", () => ({ assertExternalEffectAllowed: effects }));
vi.mock("@/lib/config/monitoring", () => ({
  getMonitoringAlertMinSeverityAsync: async () => "LOW",
  getMonitoringAlertCooldownMinutesAsync: async () => 0,
  getMonitoringAlertEmailRecipientsAsync: async () => ["ops@itrader.im"],
  getMonitoringAlertWebhookUrlAsync: async () => "https://hooks.example/alert",
}));
vi.mock("@/lib/monitoring/alert-outbox", () => ({
  enqueueMonitoringAlert: enqueue,
  processMonitoringAlertOutbox: processOutbox,
}));
vi.mock("resend", () => ({
  Resend: class {
    constructor() {
      constructed();
    }
    emails = { send };
  },
}));

import { sendResendEmail } from "@/lib/email/client";
import { sendStrictResendEmail } from "@/lib/email/send-strict";
import { dispatchMonitoringAlerts } from "@/lib/monitoring/alerts";
import { notifyMonitoringWebhook } from "@/lib/monitoring/notify-webhook";
import { StagingIdentityError, captureStagingTestEffect } from "@/lib/deployment/staging-test-effects";

const previewDb =
  "postgres://postgres.syneonzucehwlghqmfbg:test@aws-1-eu-west-2.pooler.supabase.com:5432/postgres";
const otherDb =
  "postgres://postgres.notpreview:test@aws-1-eu-west-2.pooler.supabase.com:5432/postgres";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "ITRADER_DEPLOYMENT_ROLE",
  "ITRADER_LOCAL_STAGING_FEATURES",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
] as const;

const verified: Record<string, string> = {
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://itrader.dev",
  NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
  POSTGRES_URL: previewDb,
  POSTGRES_URL_NON_POOLING: previewDb,
  DATABASE_URL: previewDb,
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM_EMAIL: "iTrader <no-reply@itrader.im>",
};

const production: Record<string, string> = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  ITRADER_DEPLOYMENT_ROLE: "production",
  NEXT_PUBLIC_APP_URL: "https://itrader.im",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  POSTGRES_URL: otherDb,
  POSTGRES_URL_NON_POOLING: otherDb,
  DATABASE_URL: otherDb,
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM_EMAIL: "iTrader <no-reply@itrader.im>",
};

function applyEnv(values: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    const value = values[key];
    if (!value) delete process.env[key];
    else vi.stubEnv(key, value);
  }
}

const email = {
  to: "person@itrader.im",
  subject: "Password reset",
  text: "Use https://itrader.dev/auth/reset?token=super-secret-token",
};

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: "audit123" });
  findIssue.mockReset().mockResolvedValue(null);
  findEvent.mockReset().mockResolvedValue(null);
  effects.mockReset().mockResolvedValue(undefined);
  send.mockReset().mockResolvedValue({ data: { id: "provider_1" }, error: null });
  constructed.mockReset();
  enqueue.mockReset().mockResolvedValue({ id: "delivery-1" });
  processOutbox.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("staging test communications", () => {
  it("captures both email entry points on verified staging without creating Resend", async () => {
    applyEnv(verified);
    await sendResendEmail({ ...email, to: ["sync@example.invalid", email.to] });
    const strict = await sendStrictResendEmail({ ...email, to: "sync@example.invalid" });

    expect(strict).toEqual({ id: "sim_audit123" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data).toMatchObject({
      adminId: "staging-test",
      action: "EMAIL",
      entityType: "StagingTestEffect",
    });
    expect(constructed).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(effects).not.toHaveBeenCalled();
  });

  it("captures when Resend is not configured and does not fall through", async () => {
    applyEnv({ ...verified, RESEND_API_KEY: undefined });
    const result = await sendStrictResendEmail(email);
    expect(result.id).toBe("sim_audit123");
    expect(constructed).not.toHaveBeenCalled();
  });

  it("propagates capture failures without calling the provider", async () => {
    applyEnv(verified);
    create.mockRejectedValue(new Error("db down"));
    await expect(sendStrictResendEmail(email)).rejects.toThrow("db down");
    await expect(sendResendEmail(email)).rejects.toThrow("db down");
    expect(constructed).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps production email delivery on the provider", async () => {
    applyEnv(production);
    const result = await sendStrictResendEmail(email);
    expect(result).toEqual({ id: "provider_1" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    await expect(sendStrictResendEmail({ ...email, to: "sync@example.invalid" })).rejects.toThrow(/synthetic/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fails closed for a staging role with the wrong database or role mismatch", async () => {
    applyEnv({ ...verified, DATABASE_URL: otherDb, POSTGRES_URL: otherDb, POSTGRES_URL_NON_POOLING: otherDb });
    await expect(sendStrictResendEmail(email)).rejects.toBeInstanceOf(StagingIdentityError);
    expect(create).not.toHaveBeenCalled();
    expect(constructed).not.toHaveBeenCalled();

    applyEnv({ ...verified, ITRADER_DEPLOYMENT_ROLE: "production" });
    await expect(sendStrictResendEmail(email)).rejects.toBeInstanceOf(StagingIdentityError);
    applyEnv({ ...verified, ITRADER_DEPLOYMENT_ROLE: undefined });
    await expect(sendResendEmail(email)).rejects.toBeInstanceOf(StagingIdentityError);
    expect(constructed).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("stores redacted subject and text and omits secrets", async () => {
    applyEnv(verified);
    await captureStagingTestEffect({
      kind: "EMAIL",
      payload: {
        ...email,
        apiKey: "sk_live_should_not_store",
        authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signaturevalue",
      },
    });
    const details = create.mock.calls[0][0].data.details as Record<string, unknown>;
    const serialised = JSON.stringify(details);
    expect(details.subject).toBe("Password reset");
    expect(serialised).not.toContain("super-secret-token");
    expect(serialised).not.toContain("sk_live_should_not_store");
    expect(serialised).not.toContain("eyJhbGci");
    expect(serialised).toContain("pe***@itrader.im");
    expect(details.apiKey).toBe("[redacted]");
    expect(details.authorization).toBe("[redacted]");
  });

  it("captures alert ids before the cloned-row check and does not enqueue", async () => {
    applyEnv(verified);
    effects.mockRejectedValue(new Error("Cloned production records cannot trigger external effects from staging."));
    await dispatchMonitoringAlerts({ issueId: "issue-1", eventId: "event-1" });
    expect(create.mock.calls[0][0].data).toMatchObject({
      adminId: "staging-test",
      action: "ALERT",
      entityType: "StagingTestEffect",
      entityId: "issue-1",
      details: { issueId: "issue-1", eventId: "event-1", reopened: false },
    });
    expect(effects).not.toHaveBeenCalled();
    expect(findIssue).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(processOutbox).not.toHaveBeenCalled();
  });

  it("still enqueues live monitoring alerts in production", async () => {
    applyEnv(production);
    findIssue.mockResolvedValue({
      id: "issue-1",
      status: "OPEN",
      severity: "CRITICAL",
      acknowledgedSeverity: null,
      mutedUntil: null,
      lastAlertedAt: null,
      title: "Disk",
      sampleMessage: "full",
      sampleRoute: "/health",
      sampleAction: null,
      source: "SERVER",
      occurrences: 2,
    });
    findEvent.mockResolvedValue({
      id: "event-1",
      severity: "CRITICAL",
      requestPath: "/health",
      environment: "production",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await dispatchMonitoringAlerts({ issueId: "issue-1", eventId: "event-1" });
    expect(effects).toHaveBeenCalledWith({
      tables: [
        { table: "MonitoringIssue", rowKey: "issue-1" },
        { table: "MonitoringEvent", rowKey: "event-1" },
      ],
    });
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(processOutbox).toHaveBeenCalledTimes(1);
  });

  it("propagates alert capture failure instead of enqueueing", async () => {
    applyEnv(verified);
    create.mockRejectedValue(new Error("db down"));
    await expect(dispatchMonitoringAlerts({ issueId: "issue-1", eventId: "event-1" })).rejects.toThrow("db down");
    expect(effects).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("captures monitoring webhooks locally without fetch, including a secret URL", async () => {
    applyEnv(verified);
    const fetchMock = vi.mocked(fetch);
    const result = await notifyMonitoringWebhook({
      webhookUrl: "https://hooks.example/alert?token=super-secret-token",
      payload: { subject: "Disk", text: "Contact person@itrader.im" },
      headers: { "X-IOM-Monitoring-Signature": "sig-value" },
    });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    const details = create.mock.calls[0][0].data.details as Record<string, unknown>;
    expect(create.mock.calls[0][0].data.action).toBe("WEBHOOK");
    expect(details.webhookUrl).toBe("[redacted]");
    expect(JSON.stringify(details)).not.toContain("super-secret-token");
    expect(JSON.stringify(details)).not.toContain("sig-value");
    expect(JSON.stringify(details)).toContain("pe***@itrader.im");
  });

  it("fetches monitoring webhooks in production and blocks a mismatched staging identity", async () => {
    applyEnv(production);
    const fetchMock = vi.mocked(fetch);
    const result = await notifyMonitoringWebhook({
      webhookUrl: "https://hooks.example/alert",
      payload: { subject: "Disk" },
    });
    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();

    applyEnv({ ...verified, DATABASE_URL: otherDb, POSTGRES_URL: otherDb, POSTGRES_URL_NON_POOLING: otherDb });
    fetchMock.mockClear();
    await expect(notifyMonitoringWebhook({
      webhookUrl: "https://hooks.example/alert",
      payload: { subject: "Disk" },
    })).rejects.toBeInstanceOf(StagingIdentityError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates webhook capture failure without fetch", async () => {
    applyEnv(verified);
    create.mockRejectedValue(new Error("db down"));
    await expect(notifyMonitoringWebhook({
      webhookUrl: "https://hooks.example/alert",
      payload: { subject: "Disk" },
    })).rejects.toThrow("db down");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
