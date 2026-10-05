"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAdminProfile, type AdminProfileEditorData } from "@/actions/admin/profile-edit";
import { AdminActionButton, AdminActionTextarea } from "@/components/admin/admin-action-controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Input } from "@/components/ui/input";
import {
  firstFieldError,
  splitActionError,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";

interface RegionOption {
  id: string;
  name: string;
}

interface DealerFormState {
  dealerId: string;
  slug: string;
  name: string;
  phone: string;
  website: string;
  bio: string;
  updatedAt: string;
}

interface AdminProfileEditFormProps {
  userId: string;
  userUpdatedAt: string;
  accountName: string;
  accountPhone: string;
  accountBio: string;
  regionId: string;
  regions: RegionOption[];
  dealer: DealerFormState | null;
  disabledAccount: boolean;
}

interface Baseline {
  userUpdatedAt: string;
  accountName: string;
  accountPhone: string;
  accountBio: string;
  regionId: string;
  dealer: DealerFormState | null;
}

export function AdminProfileEditForm({
  userId,
  userUpdatedAt,
  accountName,
  accountPhone,
  accountBio,
  regionId,
  regions,
  dealer,
  disabledAccount,
}: AdminProfileEditFormProps) {
  const router = useRouter();
  const regionFieldId = useId();
  const accountBioId = useId();
  const dealerBioId = useId();
  const [isPending, startTransition] = useTransition();
  const [baseline, setBaseline] = useState<Baseline>({
    userUpdatedAt,
    accountName,
    accountPhone,
    accountBio,
    regionId,
    dealer,
  });
  const [name, setName] = useState(accountName);
  const [phone, setPhone] = useState(accountPhone);
  const [bio, setBio] = useState(accountBio);
  const [selectedRegionId, setSelectedRegionId] = useState(regionId);
  const [dealerName, setDealerName] = useState(dealer?.name ?? "");
  const [dealerPhone, setDealerPhone] = useState(dealer?.phone ?? "");
  const [dealerWebsite, setDealerWebsite] = useState(dealer?.website ?? "");
  const [dealerBio, setDealerBio] = useState(dealer?.bio ?? "");
  const [dealerUpdatedAt, setDealerUpdatedAt] = useState(dealer?.updatedAt ?? "");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const dirty = isDirty(baseline, {
    accountName: name,
    accountPhone: phone,
    accountBio: bio,
    regionId: selectedRegionId,
    dealerName,
    dealerPhone,
    dealerWebsite,
    dealerBio,
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function requestCancel() {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    router.push(`/admin/users/${userId}`);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSuccess(null);
    setWarning(null);
    setConflict(false);

    startTransition(async () => {
      const result = await saveAdminProfile({
        userId,
        expectedUserUpdatedAt: baseline.userUpdatedAt,
        account: {
          name,
          phone,
          bio,
          regionId: selectedRegionId || null,
        },
        ...(baseline.dealer
          ? {
              dealer: {
                dealerId: baseline.dealer.dealerId,
                expectedDealerUpdatedAt: dealerUpdatedAt,
                name: dealerName,
                phone: dealerPhone,
                website: dealerWebsite,
                bio: dealerBio,
              },
            }
          : {}),
      });

      if ("error" in result) {
        const split = splitActionError(result.error);
        setFieldErrors(split.fieldErrors);
        setFormError(split.formError);
        setConflict("conflict" in result && result.conflict === true);
        return;
      }

      applySaved(result.data);
      setSuccess(result.data.unchanged ? "No changes to save." : "Profile saved.");
      setWarning(result.warning ?? null);
      router.refresh();
    });
  }

  function applySaved(data: AdminProfileEditorData) {
    const nextDealer = data.dealer
      ? {
          dealerId: data.dealer.dealerId,
          slug: data.dealer.slug,
          name: data.dealer.name,
          phone: data.dealer.phone ?? "",
          website: data.dealer.website ?? "",
          bio: data.dealer.bio ?? "",
          updatedAt: data.dealer.updatedAt,
        }
      : null;
    const nextBaseline: Baseline = {
      userUpdatedAt: data.userUpdatedAt,
      accountName: data.account.name ?? "",
      accountPhone: data.account.phone ?? "",
      accountBio: data.account.bio ?? "",
      regionId: data.account.regionId ?? "",
      dealer: nextDealer,
    };
    setBaseline(nextBaseline);
    setName(nextBaseline.accountName);
    setPhone(nextBaseline.accountPhone);
    setBio(nextBaseline.accountBio);
    setSelectedRegionId(nextBaseline.regionId);
    setDealerName(nextDealer?.name ?? "");
    setDealerPhone(nextDealer?.phone ?? "");
    setDealerWebsite(nextDealer?.website ?? "");
    setDealerBio(nextDealer?.bio ?? "");
    setDealerUpdatedAt(nextDealer?.updatedAt ?? "");
  }

  const messages = uniqueErrorMessages(fieldErrors, formError);
  const regionError = firstFieldError(fieldErrors, "account.regionId");

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        {disabledAccount ? (
          <Alert status="warning">
            This account is disabled. Saving profile details will not reactivate it.
          </Alert>
        ) : null}
        {messages.length > 0 ? <FormErrorSummary messages={messages} /> : null}
        {success ? (
          <Alert status="success">
            <p>{success}</p>
          </Alert>
        ) : null}
        {warning ? (
          <Alert status="warning">
            <p>{warning}</p>
          </Alert>
        ) : null}
        {conflict ? (
          <AdminActionButton type="button" onClick={() => window.location.reload()}>
            Reload profile
          </AdminActionButton>
        ) : null}

        <fieldset disabled={isPending} className="space-y-6 disabled:opacity-70">
          <section className="space-y-4 rounded-lg border border-border p-4">
            <h2 className="text-base font-semibold text-text-primary">Account details</h2>
            <Input
              label="Account name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              error={firstFieldError(fieldErrors, "account.name")}
              autoComplete="name"
              required
            />
            <Input
              label="Account phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              error={firstFieldError(fieldErrors, "account.phone")}
              autoComplete="tel"
            />
            <div className="flex flex-col gap-1">
              <label htmlFor={accountBioId} className="text-sm font-medium text-text-primary">
                Account bio
              </label>
              <AdminActionTextarea
                id={accountBioId}
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                rows={4}
                aria-invalid={Boolean(firstFieldError(fieldErrors, "account.bio"))}
              />
              {firstFieldError(fieldErrors, "account.bio") ? (
                <p className="text-xs text-text-error">{firstFieldError(fieldErrors, "account.bio")}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={regionFieldId} className="text-sm font-medium text-text-primary">
                Region
              </label>
              <select
                id={regionFieldId}
                value={selectedRegionId}
                onChange={(event) => setSelectedRegionId(event.target.value)}
                aria-invalid={Boolean(regionError)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:shadow-outline"
              >
                <option value="">Not set</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
              {regionError ? <p className="text-xs text-text-error">{regionError}</p> : null}
            </div>
          </section>

          {baseline.dealer ? (
            <section className="space-y-4 rounded-lg border border-border p-4">
              <h2 className="text-base font-semibold text-text-primary">Dealer details</h2>
              <p className="text-sm text-text-secondary">
                Public address{" "}
                <span className="font-mono text-text-primary">/dealers/{baseline.dealer.slug}</span>
                . Changing the business name does not change this address.
              </p>
              <Input
                label="Business name"
                value={dealerName}
                onChange={(event) => setDealerName(event.target.value)}
                error={firstFieldError(fieldErrors, "dealer.name")}
                required
              />
              <Input
                label="Dealer phone"
                value={dealerPhone}
                onChange={(event) => setDealerPhone(event.target.value)}
                error={firstFieldError(fieldErrors, "dealer.phone")}
                autoComplete="tel"
              />
              <Input
                label="Website"
                value={dealerWebsite}
                onChange={(event) => setDealerWebsite(event.target.value)}
                error={firstFieldError(fieldErrors, "dealer.website")}
                autoComplete="url"
                placeholder="https://example.com"
              />
              <div className="flex flex-col gap-1">
                <label htmlFor={dealerBioId} className="text-sm font-medium text-text-primary">
                  Dealer bio
                </label>
                <AdminActionTextarea
                  id={dealerBioId}
                  value={dealerBio}
                  onChange={(event) => setDealerBio(event.target.value)}
                  rows={4}
                  aria-invalid={Boolean(firstFieldError(fieldErrors, "dealer.bio"))}
                />
                {firstFieldError(fieldErrors, "dealer.bio") ? (
                  <p className="text-xs text-text-error">{firstFieldError(fieldErrors, "dealer.bio")}</p>
                ) : null}
              </div>
            </section>
          ) : (
            <p className="text-sm text-text-secondary">This account has no dealer profile.</p>
          )}
        </fieldset>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AdminActionButton type="button" onClick={requestCancel} disabled={isPending} className="w-full sm:w-auto">
            Cancel
          </AdminActionButton>
          <AdminActionButton
            type="submit"
            tone="primary"
            disabled={isPending || !dirty}
            className="w-full sm:w-auto"
          >
            {isPending ? "Saving…" : "Save profile"}
          </AdminActionButton>
        </div>
      </form>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>Your profile edits have not been saved.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <AdminActionButton type="button" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </AdminActionButton>
            <AdminActionButton
              type="button"
              tone="primary"
              onClick={() => router.push(`/admin/users/${userId}`)}
            >
              Discard changes
            </AdminActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function isDirty(
  baseline: Baseline,
  current: {
    accountName: string;
    accountPhone: string;
    accountBio: string;
    regionId: string;
    dealerName: string;
    dealerPhone: string;
    dealerWebsite: string;
    dealerBio: string;
  },
): boolean {
  if (
    baseline.accountName !== current.accountName ||
    baseline.accountPhone !== current.accountPhone ||
    baseline.accountBio !== current.accountBio ||
    baseline.regionId !== current.regionId
  ) {
    return true;
  }
  if (!baseline.dealer) return false;
  return (
    baseline.dealer.name !== current.dealerName ||
    baseline.dealer.phone !== current.dealerPhone ||
    baseline.dealer.website !== current.dealerWebsite ||
    baseline.dealer.bio !== current.dealerBio
  );
}
