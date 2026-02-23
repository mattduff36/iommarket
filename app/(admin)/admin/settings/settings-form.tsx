"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateSiteSetting, deleteSiteSetting } from "@/actions/admin/settings";
import { SETTING_KEYS } from "@/lib/config/setting-keys";

interface SettingsFormProps {
  settings: Array<{ key: string; value: unknown; updatedAt: Date }>;
  envDefaults: Record<string, string>;
}

const KNOWN_SETTINGS = [
  { key: SETTING_KEYS.LISTING_FEE_PENCE, label: "Listing Fee (pence)", type: "number" as const },
  { key: SETTING_KEYS.FEATURED_FEE_PENCE, label: "Featured Fee (pence)", type: "number" as const },
  { key: SETTING_KEYS.FREE_LISTING_WINDOW_DAYS, label: "Free Listing Window (days)", type: "number" as const },
  { key: SETTING_KEYS.LAUNCH_FREE_UNTIL, label: "Launch Free Until (ISO date)", type: "text" as const },
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
    <div className="space-y-6 max-w-2xl">
      {KNOWN_SETTINGS.map((setting) => {
        const dbValue = settingsMap.get(setting.key);
        const hasOverride = dbValue !== undefined;
        const currentValue = hasOverride ? String(dbValue) : "";
        const envDefault = envDefaults[setting.key] ?? "—";

        return (
          <div key={setting.key} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-text-primary">{setting.label}</label>
              <span className="text-xs text-text-tertiary">
                env default: {envDefault}
              </span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSave(setting.key, new FormData(e.currentTarget));
              }}
              className="flex items-end gap-2"
            >
              <Input
                name="value"
                type={setting.type}
                defaultValue={currentValue}
                placeholder={`Override (default: ${envDefault})`}
                className="flex-1"
              />
              <Button type="submit" size="sm" disabled={isPending}>
                Save
              </Button>
              {hasOverride && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleReset(setting.key)}
                  disabled={isPending}
                  className="text-xs"
                >
                  Reset
                </Button>
              )}
            </form>
            {hasOverride && (
              <p className="mt-1 text-xs text-emerald-500">DB override active: {String(dbValue)}</p>
            )}
          </div>
        );
      })}

      {error && <p className="text-sm text-text-error">{error}</p>}
      {success && <p className="text-sm text-emerald-500">{success}</p>}
    </div>
  );
}
