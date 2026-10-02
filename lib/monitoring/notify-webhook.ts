interface NotifyWebhookInput {
  webhookUrl: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: string;
}

export async function notifyMonitoringWebhook({
  webhookUrl,
  payload,
  headers,
  body,
}: NotifyWebhookInput): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ?? JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: response.status, error: "Webhook redirects are not followed" };
    }
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
