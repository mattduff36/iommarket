"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateMyProfile, deactivateMyAccount } from "@/actions/account";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, FileX, UserX, LogOut, CheckCircle } from "lucide-react";

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

const DELETION_STEPS = [
  { id: "listings", label: "Taking down active listings", icon: FileX },
  { id: "profile", label: "Removing profile data", icon: UserX },
  { id: "auth", label: "Deleting authentication credentials", icon: Shield },
  { id: "signout", label: "Signing out of all sessions", icon: LogOut },
  { id: "done", label: "Account deleted", icon: CheckCircle },
] as const;

function DeletionProgressOverlay({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);

  const stepCount = DELETION_STEPS.length;

  const advanceSteps = useCallback(() => {
    const stepDuration = 1200;
    const tickInterval = 30;
    const ticksPerStep = stepDuration / tickInterval;
    let tick = 0;

    const interval = setInterval(() => {
      tick++;
      const totalTicks = stepCount * ticksPerStep;
      const currentProgress = Math.min((tick / totalTicks) * 100, 100);
      setProgress(currentProgress);

      const step = Math.min(Math.floor(tick / ticksPerStep), stepCount - 1);
      setCurrentStep(step);

      if (tick >= totalTicks) {
        clearInterval(interval);
        setTimeout(onComplete, 800);
      }
    }, tickInterval);

    return () => clearInterval(interval);
  }, [stepCount, onComplete]);

  useEffect(() => {
    return advanceSteps();
  }, [advanceSteps]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-canvas/95 backdrop-blur-sm">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neon-red-500/10">
            <Shield className="h-8 w-8 text-neon-red-500 animate-pulse" />
          </div>
          <h2 className="text-xl font-bold text-text-primary font-heading">
            Deleting Your Account
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Please wait while we securely remove your data...
          </p>
        </div>

        <div className="mb-6">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-elevated">
            <div
              className="h-full rounded-full bg-gradient-to-r from-neon-red-500 to-neon-red-400 transition-all duration-150 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-right text-xs text-text-secondary tabular-nums">
            {Math.round(progress)}%
          </p>
        </div>

        <div className="space-y-3">
          {DELETION_STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = index === currentStep;
            const isComplete = index < currentStep;
            const isPending = index > currentStep;

            return (
              <div
                key={step.id}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-all duration-300 ${
                  isActive
                    ? "border-neon-red-500/50 bg-neon-red-500/5 shadow-sm"
                    : isComplete
                      ? "border-neon-blue-500/30 bg-neon-blue-500/5"
                      : "border-border/50 bg-surface/50 opacity-40"
                }`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
                    isActive
                      ? "bg-neon-red-500/20"
                      : isComplete
                        ? "bg-neon-blue-500/20"
                        : "bg-surface-elevated"
                  }`}
                >
                  {isComplete ? (
                    <CheckCircle className="h-4 w-4 text-neon-blue-500" />
                  ) : (
                    <Icon
                      className={`h-4 w-4 transition-colors duration-300 ${
                        isActive
                          ? "text-neon-red-500 animate-pulse"
                          : "text-text-secondary"
                      }`}
                    />
                  )}
                </div>
                <span
                  className={`text-sm font-medium transition-colors duration-300 ${
                    isActive
                      ? "text-text-primary"
                      : isComplete
                        ? "text-neon-blue-500"
                        : isPending
                          ? "text-text-tertiary"
                          : "text-text-secondary"
                  }`}
                >
                  {step.label}
                  {isComplete && (
                    <span className="ml-2 text-xs text-neon-blue-500">Done</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-center text-xs text-text-tertiary">
          You&apos;ll be redirected to the home page shortly.
        </p>
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
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);

  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const [confirmationText, setConfirmationText] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showDeletionProgress, setShowDeletionProgress] = useState(false);

  function parseFieldError(error: unknown): string {
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const values = Object.values(error as Record<string, unknown>)
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .filter((value): value is string => typeof value === "string");
      if (values.length > 0) return values[0];
    }
    return "Something went wrong. Please try again.";
  }

  function handleProfileSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileError(null);
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
        setProfileError(parseFieldError(result.error));
        return;
      }

      setProfileSuccess("Profile updated.");
      router.refresh();
    });
  }

  async function handleEmailChange(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEmailError(null);
    setEmailMessage(null);
    setEmailLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) {
        setEmailError(error.message);
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
        setSessionError(error.message);
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
    setDeleteLoading(true);
    try {
      const result = await deactivateMyAccount({
        confirmationText: confirmationText as "DELETE MY ACCOUNT",
        reason: deletionReason,
      });

      if (result.error) {
        setDeleteError(parseFieldError(result.error));
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
    return <DeletionProgressOverlay onComplete={handleDeletionComplete} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile Basics</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleProfileSubmit} className="space-y-4">
            <Input
              label="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={100}
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
            />

            <Input
              label="Avatar URL (optional)"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
              maxLength={500}
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

            {profileError ? <p className="text-sm text-text-error">{profileError}</p> : null}
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

          <form onSubmit={handleEmailChange} className="rounded-md border border-border p-4 space-y-3">
            <p className="text-sm font-medium text-text-primary">Email Address</p>
            <p className="text-xs text-text-secondary">
              Current: {user.email}
            </p>
            <Input
              label="New email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
            {emailError ? <p className="text-sm text-text-error">{emailError}</p> : null}
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
          <form onSubmit={handleAccountDeletion} className="space-y-3">
            <p className="text-sm text-text-secondary">
              This deactivates your account and takes down active listings. Type{" "}
              <span className="font-semibold text-text-primary">DELETE MY ACCOUNT</span> to confirm.
            </p>
            <Input
              label="Confirmation"
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              required
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
            {deleteError ? <p className="text-sm text-text-error">{deleteError}</p> : null}
            <Button type="submit" variant="energy" size="sm" loading={deleteLoading}>
              Delete My Account
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
