import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";
import { Button } from "@/components/ui/button";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Forgot password</h1>
      <p className="mb-6 text-center text-sm text-text-secondary">
        Enter your email and we&apos;ll send you a link to reset your password.
      </p>
      <ForgotPasswordForm />
      <div className="mt-6">
        <Button asChild variant="link" size="sm">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </div>
    </div>
  );
}
