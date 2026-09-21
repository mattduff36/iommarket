"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createLaunchPromotionCampaign,
  revokeDealerOnboardingInvite,
  sendDealerOnboardingInvite,
} from "@/actions/admin/dealer-onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DealerOption {
  id: string;
  name: string;
  currentEmail: string;
  tier: string;
  accessLabel: string;
  resultingEndLabel: string;
}

interface InviteRow {
  id: string;
  dealerName: string;
  recipientEmail: string;
  statusLabel: string;
  canResend: boolean;
  canRevoke: boolean;
  dealerId: string;
  expiresLabel: string;
  error: string | null;
}

interface OnboardingManagerProps {
  campaign: {
    startsLabel: string;
    endsLabel: string;
    locked: boolean;
  } | null;
  dealers: DealerOption[];
  invites: InviteRow[];
  selectedDealerId: string | null;
}

export function OnboardingManager({
  campaign,
  dealers,
  invites,
  selectedDealerId,
}: OnboardingManagerProps) {
  const router = useRouter();
  const [launchAtLocal, setLaunchAtLocal] = useState("");
  const [dealerId, setDealerId] = useState(selectedDealerId ?? dealers[0]?.id ?? "");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selected = dealers.find((dealer) => dealer.id === dealerId) ?? null;

  function run(action: () => Promise<{ error?: unknown; data?: unknown }>, success: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Check the form and try again.");
        return;
      }
      setMessage(success);
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-text-primary">Launch campaign</h2>
        {campaign ? (
          <div className="mt-3 space-y-1 text-sm text-text-secondary">
            <p>Starts {campaign.startsLabel}</p>
            <p>Dealer Pro runs until {campaign.endsLabel}</p>
            <p>{campaign.locked ? "Dates are locked." : "Dates can still be changed before the first invitation is prepared."}</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-text-secondary">
            Enter the exact Isle of Man launch date and time. Pro access ends three calendar months later.
          </p>
        )}
        {!campaign?.locked ? (
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () => createLaunchPromotionCampaign({ launchAtLocal }),
                "Launch campaign saved.",
              );
            }}
          >
            <label className="text-sm text-text-primary">
              Launch date and time
              <input
                required
                type="datetime-local"
                value={launchAtLocal}
                onChange={(event) => setLaunchAtLocal(event.target.value)}
                className="mt-1 block h-10 rounded-md border border-border bg-canvas px-3 text-sm"
              />
            </label>
            <Button type="submit" disabled={isPending}>
              {campaign ? "Update campaign" : "Create campaign"}
            </Button>
          </form>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-text-primary">Send one invitation</h2>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => sendDealerOnboardingInvite({ dealerId, recipientEmail }),
              "Invitation email sent.",
            );
          }}
        >
          <label className="text-sm text-text-primary">
            Dealer account
            <select
              required
              value={dealerId}
              onChange={(event) => setDealerId(event.target.value)}
              className="mt-1 block h-10 w-full rounded-md border border-border bg-canvas px-3 text-sm"
            >
              {dealers.map((dealer) => (
                <option key={dealer.id} value={dealer.id}>
                  {dealer.name} ({dealer.currentEmail})
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <div className="rounded-md border border-border bg-canvas/40 p-3 text-sm text-text-secondary">
              <p>Current package: {selected.tier}</p>
              <p>Current access: {selected.accessLabel}</p>
              <p>Pro access after acceptance: {selected.resultingEndLabel}</p>
            </div>
          ) : null}
          <Input
            label="Owner email"
            type="email"
            autoComplete="off"
            required
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
          />
          <Button type="submit" disabled={isPending || !campaign}>
            Send onboarding email
          </Button>
          {!campaign ? (
            <p className="text-sm text-text-secondary">Create the launch campaign before sending email.</p>
          ) : null}
        </form>
      </section>

      {error ? <p className="text-sm text-text-error">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-500">{message}</p> : null}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-text-primary">Invitations</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas/40 text-left text-text-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">Dealer</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id} className="border-t border-border">
                  <td className="px-3 py-2 text-text-primary">{invite.dealerName}</td>
                  <td className="px-3 py-2 text-text-secondary">{invite.recipientEmail}</td>
                  <td className="px-3 py-2">
                    <p className="text-text-primary">{invite.statusLabel}</p>
                    {invite.error ? <p className="text-xs text-text-error">{invite.error}</p> : null}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{invite.expiresLabel}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {invite.canResend ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () =>
                                sendDealerOnboardingInvite({
                                  dealerId: invite.dealerId,
                                  recipientEmail: invite.recipientEmail,
                                }),
                              "Invitation email sent again.",
                            )
                          }
                        >
                          Resend
                        </Button>
                      ) : null}
                      {invite.canRevoke ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => revokeDealerOnboardingInvite({ inviteId: invite.id }),
                              "Invitation revoked.",
                            )
                          }
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {invites.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-text-tertiary">
                    No invitations yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
