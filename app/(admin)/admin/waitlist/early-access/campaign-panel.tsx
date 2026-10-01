"use client";

import { useState, useTransition } from "react";
import {
  confirmEarlyAccessCampaign,
  retryEarlyAccessFailures,
  saveEarlyAccessDraft,
  sendEarlyAccessTest,
} from "@/actions/admin/waitlist-early-access";
import { Button } from "@/components/ui/button";
import { EARLY_ACCESS_CONFIRM_PHRASE } from "@/lib/validations/waitlist-early-access";

export function EarlyAccessCampaignPanel({
  initialBody,
  eligibleCount,
  status,
  counts,
  bulkAllowed,
  testAllowed,
  previewWithoutGate,
}: {
  initialBody: string;
  eligibleCount: number;
  status: string;
  counts: { total: number; sent: number; failed: number; skipped: number };
  bulkAllowed: boolean;
  testAllowed: boolean;
  previewWithoutGate: boolean;
}) {
  const [body, setBody] = useState(initialBody);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [pending, startTransition] = useTransition();
  const frozen = status !== "DRAFT" && status !== "NONE";

  function run(action: () => Promise<{ error?: unknown; data?: unknown }>, success: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Check the message and try again.");
        return;
      }
      setMessage(success);
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-text-primary">Invitation message</h2>
        <p className="mt-1 text-sm text-text-secondary">
          {eligibleCount} consented car buyer or seller {eligibleCount === 1 ? "address is" : "addresses are"} eligible.
          The subject, title, and button stay fixed around this message.
        </p>
        <textarea
          value={frozen ? initialBody : body}
          onChange={(event) => setBody(event.target.value)}
          readOnly={frozen}
          maxLength={2000}
          rows={8}
          aria-label="Invitation message"
          className="mt-4 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary"
        />
        {previewWithoutGate ? (
          <p className="mt-3 text-sm text-text-secondary">
            Preview is currently open. Enable the preview QA gate before testing an invitation link.
          </p>
        ) : null}
        {!bulkAllowed ? (
          <p className="mt-3 text-sm text-text-secondary">
            Bulk sending stays blocked here. It runs only on closed production after the confirmation phrase.
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="ghost"
          disabled={pending || frozen}
          onClick={() => run(() => saveEarlyAccessDraft({ bodyText: body }), "Draft saved.")}
        >
          Save draft
        </Button>
        <Button
          type="button"
          variant="trust"
          disabled={pending || !testAllowed}
          onClick={() => run(() => sendEarlyAccessTest({ bodyText: body }), "Test invitation sent to your admin email.")}
        >
          Send test to me
        </Button>
        {bulkAllowed && !frozen ? (
          <Button
            type="button"
            variant="energy"
            disabled={pending}
            onClick={() => {
              if (phrase !== EARLY_ACCESS_CONFIRM_PHRASE) {
                setError(`Enter ${EARLY_ACCESS_CONFIRM_PHRASE} to confirm.`);
                return;
              }
              run(
                () => confirmEarlyAccessCampaign({ bodyText: body, confirmation: phrase }),
                "Campaign queued. Delivery will continue until every invitation is finished.",
              );
            }}
          >
            Confirm and send
          </Button>
        ) : null}
        {bulkAllowed && frozen ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => retryEarlyAccessFailures(), "Retry started for unfinished invitations.")}
          >
            Retry unfinished
          </Button>
        ) : null}
      </div>

      {frozen ? (
        <p className="text-sm text-text-secondary">
          Status {status}. Sent {counts.sent}, failed {counts.failed}, skipped {counts.skipped}, total {counts.total}.
        </p>
      ) : null}
      {message ? <p className="text-sm text-text-primary">{message}</p> : null}
      {error ? (
        <p className="text-sm text-text-error" role="alert">
          {error}
        </p>
      ) : null}

      {bulkAllowed && !frozen ? (
        <label className="block text-sm text-text-secondary">
          Type {EARLY_ACCESS_CONFIRM_PHRASE} to queue {eligibleCount} invitations
          <input
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            className="mt-2 w-full max-w-sm rounded-md border border-border bg-surface-elevated px-3 py-2 text-text-primary"
            aria-label="Confirmation phrase"
          />
        </label>
      ) : null}
    </div>
  );
}
