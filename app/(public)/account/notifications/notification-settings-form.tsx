"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateNotificationSettings,
  type NotificationSettingsState,
} from "@/actions/account-notifications";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { NotificationPreferenceKey } from "@/lib/notifications/preferences";

export type NotificationSettingsField = {
  key: NotificationPreferenceKey;
  label: string;
  description: string;
  enabled: boolean;
};

function PreferenceControls({
  fields,
  values,
  onChange,
}: {
  fields: NotificationSettingsField[];
  values: Record<NotificationPreferenceKey, boolean>;
  onChange: (key: NotificationPreferenceKey, enabled: boolean) => void;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-text-primary">Email preferences</legend>
        {fields.map((field) => {
          const descriptionId = `${field.key}-description`;
          return (
            <div key={field.key} className="rounded-md border border-border p-4">
              <input type="hidden" name={field.key} value={values[field.key] ? "true" : "false"} />
              <Switch
                id={field.key}
                label={field.label}
                checked={values[field.key]}
                disabled={pending}
                onCheckedChange={(checked) => onChange(field.key, checked)}
                aria-describedby={descriptionId}
              />
              <p id={descriptionId} className="mt-2 pl-11 text-sm text-text-secondary">
                {field.description}
              </p>
            </div>
          );
        })}
      </fieldset>
      <Button type="submit" loading={pending} disabled={pending}>
        {pending ? "Saving preferences…" : "Save preferences"}
      </Button>
    </>
  );
}

export function NotificationSettingsForm({ fields }: { fields: NotificationSettingsField[] }) {
  const [state, formAction] = useActionState<NotificationSettingsState, FormData>(
    updateNotificationSettings,
    { status: "idle", message: "" },
  );
  const [values, setValues] = useState<Record<NotificationPreferenceKey, boolean>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.enabled])) as Record<
      NotificationPreferenceKey,
      boolean
    >,
  );

  return (
    <form action={formAction} className="space-y-6">
      {state.status === "success" ? <Alert status="success">{state.message}</Alert> : null}
      {state.status === "error" ? <Alert status="error">{state.message}</Alert> : null}
      <PreferenceControls
        fields={fields}
        values={values}
        onChange={(key, enabled) => setValues((current) => ({ ...current, [key]: enabled }))}
      />
    </form>
  );
}
