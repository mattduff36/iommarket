"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { firstFieldError, publicAuthErrorMessage, uniqueErrorMessages, type FieldErrors } from "@/lib/forms/action-error";

export function ChangePasswordForm() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const nextErrors: FieldErrors = {};
    if (newPassword.length < 8) {
      nextErrors.newPassword = ["Password must be at least 8 characters."];
    }
    if (newPassword !== confirmPassword) {
      nextErrors.confirmPassword = ["Passwords do not match."];
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: err } = await supabase.auth.updateUser({ password: newPassword });
      if (err) {
        setError(
          publicAuthErrorMessage(
            err.message,
            "We could not update your password. Try a stronger password, then try again.",
          ),
        );
        return;
      }
      setSuccess(true);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <p className="text-text-primary">
        Your password has been updated. You can now sign in with your new password.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <FormErrorSummary messages={uniqueErrorMessages(fieldErrors, error)} />
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        required
        minLength={8}
        error={firstFieldError(fieldErrors, "newPassword")}
      />
      <Input
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
        minLength={8}
        error={firstFieldError(fieldErrors, "confirmPassword")}
      />
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
