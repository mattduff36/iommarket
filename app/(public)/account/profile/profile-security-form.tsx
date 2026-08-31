"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateMyProfile, deactivateMyAccount } from "@/actions/account";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import {
  firstFieldError,
  firstZodMessage,
  publicAuthErrorMessage,
  splitActionError,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";
import { emailField } from "@/lib/validations/email";

interface RegionOption {
  id: string;
  name: string;
}

interface Props {
  user: {
    name: string;
    email: string;
    phone: string | null;
    bio: string | null;
    avatarUrl: string | null;
    regionId: string | null;
    hasDealerProfile: boolean;
  };
  regions: RegionOption[];
}

function DeletionRequestedNotice({
  onComplete,
}: {
  onComplete: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-canvas/95 backdrop-blur-sm">
      <div className="w-full max-w-md px-6">
        <div className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-xl font-bold text-text-primary font-heading">
            Deletion request received
          </h2>
          <p className="mt-3 text-sm text-text-secondary">
            Your account is now disabled and any live listings have been taken
            down. Remaining identifiers, login credentials, and eligible media
            are removed in a second queued step. Financial, fraud, and audit
            records are kept where the law requires.
          </p>
          <Button className="mt-5 w-full" onClick={onComplete}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProfileSecurityForm({ user, regions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [regionId, setRegionId] = useState(user.regionId ?? "");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileFieldErrors, setProfileFieldErrors] = useState<FieldErrors>({});
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailFieldError, setEmailFieldError] = useState<string | undefined>();
  const [emailLoading, setEmailLoading] = useState(false);

  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const [confirmationText, setConfirmationText] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteFieldErrors, setDeleteFieldErrors] = useState<FieldErrors>({});
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showDeletionProgress, setShowDeletionProgress] = useState(false);

  function handleProfileSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileError(null);
    setProfileFieldErrors({});
    setProfileSuccess(null);

    startTransition(async () => {
      const result = await updateMyProfile({
        name,
        phone,
        bio,
        avatarUrl,
        regionId: regionId || null,
      });

      if (result.error) {
        const split = splitActionError(result.error);
        setProfileFieldErrors(split.fieldErrors);
        setProfileError(split.formError);
        return;
      }

      setProfileSuccess("Profile updated.");
      router.refresh();
    });
  }

  async function handleEmailChange(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEmailError(null);
    setEmailFieldError(undefined);
    setEmailMessage(null);
    const parsedEmail = emailField.safeParse(newEmail);
    if (!parsedEmail.success) {
      setEmailFieldError(firstZodMessage(parsedEmail.error));
      return;
    }
    setEmailLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ email: parsedEmail.data });
      if (error) {
        setEmailError(
          publicAuthErrorMessage(
            error.message,
            "We could not update your email. Check the address and try again.",
          ),
        );
        return;
      }
      setEmailMessage("Check your inbox to confirm your new email address.");
      setNewEmail("");
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleSignOutOtherSessions() {
    setSessionError(null);
    setSessionMessage(null);
    setSessionLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) {
        setSessionError(
          publicAuthErrorMessage(
            error.message,
            "We could not sign out other devices. Please try again shortly.",
          ),
        );
        return;
      }
      setSessionMessage("Signed out from other devices.");
    } finally {
      setSessionLoading(false);
    }
  }

  async function handleAccountDeletion(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDeleteError(null);
    setDeleteFieldErrors({});
    setDeleteLoading(true);
    try {
      const result = await deactivateMyAccount({
        confirmationText: confirmationText as "DELETE MY ACCOUNT",
        reason: deletionReason,
      });

      if (result.error) {
        const split = splitActionError(result.error);
        setDeleteFieldErrors(split.fieldErrors);
        setDeleteError(split.formError);
        setDeleteLoading(false);
        return;
      }

      setShowDeletionProgress(true);
    } catch {
      setDeleteError("Something went wrong. Please try again.");
      setDeleteLoading(false);
    }
  }

  async function handleDeletionComplete() {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // sign-out may fail if auth was already deleted server-side
    }
    window.location.href = "/";
  }

  if (showDeletionProgress) {
    return <DeletionRequestedNotice onComplete={handleDeletionComplete} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile Basics</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleProfileSubmit} noValidate className="space-y-4">
            <FormErrorSummary messages={uniqueErrorMessages(profileFieldErrors, profileError)} />
            <Input
              label="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={100}
              error={firstFieldError(profileFieldErrors, "name")}
            />

            <div className="flex flex-col gap-1">
              <label htmlFor="region" className="text-sm font-medium text-text-primary">
                Region
              </label>
              <select
                id="region"
                value={regionId}
                onChange={(e) => setRegionId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline"
              >
                <option value="">No default region</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Phone (optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
              error={firstFieldError(profileFieldErrors, "phone")}
            />

            <Input
              label="Avatar URL (optional)"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
              maxLength={500}
              error={firstFieldError(profileFieldErrors, "avatarUrl")}
            />

            <div className="flex flex-col gap-1">
              <label htmlFor="bio" className="text-sm font-medium text-text-primary">
                Bio (optional)
              </label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                maxLength={2000}
                className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus focus:shadow-outline"
              />
            </div>

            {firstFieldError(profileFieldErrors, "bio") ? (
              <p className="text-xs text-text-error">{firstFieldError(profileFieldErrors, "bio")}</p>
            ) : null}

            {profileSuccess ? <p className="text-sm text-neon-blue-400">{profileSuccess}</p> : null}

            <Button type="submit" loading={isPending}>
              Save Profile
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account Security</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-md border border-border p-4">
            <p className="text-sm font-medium text-text-primary">Password</p>
            <p className="mt-1 text-xs text-text-secondary">
              Change your password using the secure password reset flow.
            </p>
            <Button asChild size="sm" variant="ghost" className="mt-3">
              <Link href="/account/change-password">Change Password</Link>
            </Button>
          </div>

          <form onSubmit={handleEmailChange} noValidate className="rounded-md border border-border p-4 space-y-3">
            <p className="text-sm font-medium text-text-primary">Email Address</p>
            <p className="text-xs text-text-secondary">
              Current: {user.email}
            </p>
            <FormErrorSummary messages={emailError ? [emailError] : []} />
            <Input
              label="New email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
              error={emailFieldError}
            />
            {emailMessage ? <p className="text-sm text-neon-blue-400">{emailMessage}</p> : null}
            <Button type="submit" size="sm" loading={emailLoading}>
              Update Email
            </Button>
          </form>

          <div className="rounded-md border border-border p-4">
            <p className="text-sm font-medium text-text-primary">Sessions</p>
            <p className="mt-1 text-xs text-text-secondary">
              Sign out of all other active sessions while keeping this device signed in.
            </p>
            {sessionError ? <p className="mt-2 text-sm text-text-error">{sessionError}</p> : null}
            {sessionMessage ? <p className="mt-2 text-sm text-neon-blue-400">{sessionMessage}</p> : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-3"
              loading={sessionLoading}
              onClick={handleSignOutOtherSessions}
            >
              Sign Out Other Devices
            </Button>
          </div>
        </CardContent>
      </Card>

      {user.hasDealerProfile ? (
        <Card>
          <CardHeader>
            <CardTitle>Dealer Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-secondary">
              Manage your public dealer profile details and contact information.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/dealer/profile">Manage Dealer Profile</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Become a Dealer</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-secondary">
              Upgrade to a dealer account to list more vehicles and unlock your public
              dealer profile.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/dealer/subscribe?tier=STARTER">Choose Starter</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href="/dealer/subscribe?tier=PRO">Choose Pro</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-neon-red-500">Delete Account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAccountDeletion} noValidate className="space-y-3">
            <p className="text-sm text-text-secondary">
              This is a two-step request. First we disable your account and take
              down live listings. A later queued step removes login credentials,
              profile identifiers, and eligible media. Payments, subscriptions,
              and audit records are kept. Type{" "}
              <span className="font-semibold text-text-primary">DELETE MY ACCOUNT</span> to confirm.
            </p>
            <FormErrorSummary messages={uniqueErrorMessages(deleteFieldErrors, deleteError)} />
            <Input
              label="Confirmation"
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              required
              error={firstFieldError(deleteFieldErrors, "confirmationText")}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="reason" className="text-sm font-medium text-text-primary">
                Reason (optional)
              </label>
              <textarea
                id="reason"
                value={deletionReason}
                onChange={(e) => setDeletionReason(e.target.value)}
                rows={3}
                maxLength={500}
                className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus focus:shadow-outline"
              />
            </div>
            {firstFieldError(deleteFieldErrors, "reason") ? (
              <p className="text-xs text-text-error">{firstFieldError(deleteFieldErrors, "reason")}</p>
            ) : null}
            <Button type="submit" variant="energy" size="sm" loading={deleteLoading}>
              Delete My Account
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
