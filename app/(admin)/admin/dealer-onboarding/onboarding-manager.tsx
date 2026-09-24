"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  revokeDealerOnboardingInvite,
  sendDealerOnboardingInvite,
} from "@/actions/admin/dealer-onboarding";
import { ONBOARDING_PRO_END_LABEL } from "@/lib/dealers/onboarding/grant-plan";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminDateCellClass,
} from "@/components/admin/admin-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  dealers: DealerOption[];
  invites: InviteRow[];
  selectedDealerId: string | null;
}

export function OnboardingManager({
  dealers,
  invites,
  selectedDealerId,
}: OnboardingManagerProps) {
  const router = useRouter();
  const [dealerId, setDealerId] = useState(
    dealers.some((dealer) => dealer.id === selectedDealerId) ? selectedDealerId ?? "" : dealers[0]?.id ?? "",
  );
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
      <section className="rounded-lg border border-neon-blue-500/20 bg-neon-blue-500/5 p-4 sm:p-5">
        <h2 className="text-base font-semibold text-text-primary">Complimentary Pro</h2>
        <p className="mt-1 text-sm leading-6 text-text-secondary">
          Pro access starts when the dealer accepts the invitation and ends at {ONBOARDING_PRO_END_LABEL}.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-low sm:p-5">
        <h2 className="text-lg font-semibold text-text-primary">Send one invitation</h2>
        <p className="mt-1 text-sm leading-6 text-text-secondary">
          Choose the existing dealer account, then confirm the owner email that should receive the claim link.
        </p>
        <form
          className="mt-5 grid max-w-2xl gap-4"
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
              {dealers.length === 0 ? (
                <option value="">No claimable dealers selected</option>
              ) : null}
              {dealers.map((dealer) => (
                <option key={dealer.id} value={dealer.id}>
                  {dealer.name} ({dealer.currentEmail})
                </option>
              ))}
            </select>
          </label>
          {dealers.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Only dealers selected in Preview Packs with a claimable account appear here.
            </p>
          ) : null}
          {selected ? (
            <dl className="grid gap-2 rounded-md border border-border bg-canvas/40 p-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-text-tertiary">Current package</dt>
                <dd className="mt-0.5 text-text-primary">{selected.tier}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-tertiary">Current access</dt>
                <dd className="mt-0.5 text-text-primary">{selected.accessLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-tertiary">After acceptance</dt>
                <dd className="mt-0.5 text-text-primary">{selected.resultingEndLabel}</dd>
              </div>
            </dl>
          ) : null}
          <Input
            label="Owner email"
            type="email"
            autoComplete="off"
            required
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
          />
          <div>
            <Button type="submit" disabled={isPending || !selected}>
              Send onboarding email
            </Button>
          </div>
        </form>
      </section>

      {error ? <p role="alert" className="text-sm text-text-error">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-emerald-500">{message}</p> : null}

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-text-primary">Invitations</h2>
          <p className="mt-1 text-sm text-text-secondary">
            The 50 most recently created invitations are shown.
          </p>
        </div>
        <AdminTable minWidth="wide">
            <TableHeader>
              <TableRow>
                <TableHead>Dealer</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className={adminActionsCellClass}>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell className="font-medium">{invite.dealerName}</TableCell>
                  <TableCell className="text-text-secondary">{invite.recipientEmail}</TableCell>
                  <TableCell>
                    <p className="text-text-primary">{invite.statusLabel}</p>
                    {invite.error ? <p className="mt-0.5 text-xs text-text-error">{invite.error}</p> : null}
                  </TableCell>
                  <TableCell className={adminDateCellClass}>{invite.expiresLabel}</TableCell>
                  <TableCell className={adminActionsCellClass}>
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
                  </TableCell>
                </TableRow>
              ))}
              {invites.length === 0 ? (
                <TableRow>
                  <AdminTableEmpty colSpan={5}>
                    No onboarding invitations have been sent yet.
                  </AdminTableEmpty>
                </TableRow>
              ) : null}
            </TableBody>
          </AdminTable>
      </section>
    </div>
  );
}
