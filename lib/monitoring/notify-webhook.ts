interface NotifyWebhookInput {
  webhookUrl: string;
  payload: Record<string, unknown>;
}

export async function notifyMonitoringWebhook({
  webhookUrl,
  payload,
}: NotifyWebhookInput): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `Webhook returned status ${response.status}`,
      };
    }

    return { ok: true, status: response.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Webhook request failed",
    };
  }
}
