import { redirect } from "next/navigation";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const user = await requireAcceptedUser("/account/change-password");

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Change password</h1>
      <ChangePasswordForm />
    </div>
  );
}
