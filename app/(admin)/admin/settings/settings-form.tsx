"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdminActionButton } from "@/components/admin/admin-action-controls";
import { Input } from "@/components/ui/input";
import { updateSiteSetting, deleteSiteSetting } from "@/actions/admin/settings";
import { SETTING_KEYS } from "@/lib/config/setting-keys";

interface SettingsFormProps {
  settings: Array<{ key: string; value: unknown; updatedAt: Date }>;
  envDefaults: Record<string, string>;
}

const KNOWN_SETTINGS = [
  { key: SETTING_KEYS.FREE_LISTING_WINDOW_DAYS, label: "Free Listing Window (days)", type: "number" as const },
  { key: SETTING_KEYS.LAUNCH_FREE_UNTIL, label: "Launch Free Until (ISO date)", type: "text" as const },
  { key: SETTING_KEYS.FREE_LAUNCH_SLOTS_TOTAL, label: "Free Launch Slots (first N people)", type: "number" as const },
  { key: SETTING_KEYS.MONITORING_ALERT_EMAILS, label: "Monitoring Alert Emails (comma-separated)", type: "text" as const },
  { key: SETTING_KEYS.MONITORING_ALERT_WEBHOOK_URL, label: "Monitoring Alert Webhook URL", type: "text" as const },
  { key: SETTING_KEYS.MONITORING_ALERT_MIN_SEVERITY, label: "Monitoring Alert Minimum Severity (LOW|MEDIUM|HIGH|CRITICAL)", type: "text" as const },
  { key: SETTING_KEYS.MONITORING_ALERT_COOLDOWN_MINUTES, label: "Monitoring Alert Cooldown (minutes)", type: "number" as const },
];

export function SettingsForm({ settings, envDefaults }: SettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const settingsMap = new Map(settings.map((s) => [s.key, s.value]));

  function handleSave(key: string, formData: FormData) {
    setError(null);
    setSuccess(null);
    const raw = (formData.get("value") as string).trim();

    let value: unknown = raw;
    const knownSetting = KNOWN_SETTINGS.find((s) => s.key === key);
    if (knownSetting?.type === "number") {
      value = Number(raw);
      if (Number.isNaN(value as number)) {
        setError(`${key}: must be a number`);
        return;
      }
    }

    startTransition(async () => {
      const result = await updateSiteSetting({ key, value });
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed to save");
      } else {
        setSuccess(`${key} updated`);
        router.refresh();
      }
    });
  }

  function handleReset(key: string) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await deleteSiteSetting(key);
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed to reset");
      } else {
        setSuccess(`${key} reset to env default`);
        router.refresh();
      }
    });
  }

  return (
    <section className="max-w-3xl">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Operational overrides</h2>
        <p className="mt-1 text-sm leading-6 text-text-secondary">
          Leave a setting without an override to keep using the environment or code default shown beside it.
        </p>
      </div>
      <div className="space-y-4">
        {KNOWN_SETTINGS.map((setting) => {
          const dbValue = settingsMap.get(setting.key);
          const hasOverride = dbValue !== undefined;
          const currentValue = hasOverride ? String(dbValue) : "";
          const envDefault = envDefaults[setting.key] ?? "-";
          const inputId = `setting-${setting.key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

          return (
            <div key={setting.key} className="rounded-lg border border-border bg-surface p-4 shadow-low sm:p-5">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <label htmlFor={inputId} className="text-sm font-medium text-text-primary">
                  {setting.label}
                </label>
                <span className="break-all text-xs text-text-tertiary">
                  Default: {envDefault}
                </span>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSave(setting.key, new FormData(e.currentTarget));
                }}
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
              >
                <Input
                  id={inputId}
                  name="value"
                  type={setting.type}
                  defaultValue={currentValue}
                  placeholder={`Override (default: ${envDefault})`}
                  className="min-w-0 flex-1"
                />
                <div className="flex flex-wrap gap-2">
                  <AdminActionButton type="submit" disabled={isPending} tone="primary">
                    Save
                  </AdminActionButton>
                  {hasOverride && (
                    <AdminActionButton
                      onClick={() => handleReset(setting.key)}
                      disabled={isPending}
                    >
                      Reset
                    </AdminActionButton>
                  )}
                </div>
              </form>
              {hasOverride && (
                <p className="mt-2 break-all text-xs text-emerald-500">
                  Database override active: {String(dbValue)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div aria-live="polite" className="mt-4 min-h-5">
        {error && <p role="alert" className="text-sm text-text-error">{error}</p>}
        {success && <p role="status" className="text-sm text-emerald-500">{success}</p>}
      </div>
    </section>
  );
}
