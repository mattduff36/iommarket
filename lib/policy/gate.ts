import { redirect } from "next/navigation";
import {
  AccountDisabledError,
  AuthenticationRequiredError,
  getCurrentUser,
  requireAuth,
} from "@/lib/auth";
import {
  ACCEPTANCE_REQUIRED_REDIRECT,
  requireAccountAcceptance,
} from "@/lib/policy/acceptance";

export class PolicyAcceptanceRequiredError extends Error {
  readonly statusCode = 403 as const;
  constructor(message = "Current policy acceptance is required.") {
    super(message);
    this.name = "PolicyAcceptanceRequiredError";
  }
}

export class PolicyAcceptanceVerificationError extends Error {
  readonly statusCode = 500 as const;
  constructor(message = "Unable to verify policy acceptance.") {
    super(message);
    this.name = "PolicyAcceptanceVerificationError";
  }
}

export function acceptedAuthHttpStatus(error: unknown): 401 | 403 | 500 {
  if (error instanceof AuthenticationRequiredError) return 401;
  if (error instanceof AccountDisabledError) return 403;
  if (error instanceof PolicyAcceptanceRequiredError) return 403;
  if (error instanceof PolicyAcceptanceVerificationError) return 500;
  return 500;
}

function withNext(path: string, nextPath: string) {
  return `${path}?next=${encodeURIComponent(nextPath)}`;
}

export async function requireAcceptedUser(nextPath: string) {
  const user = await getCurrentUser();
  if (!user) {
    redirect(withNext("/sign-up", nextPath));
  }
  const gate = await requireAccountAcceptance(user.id);
  if (!gate.ok) {
    redirect(withNext(gate.redirectTo, nextPath));
  }
  return user;
}

export async function requireAcceptedAuth() {
  const user = await requireAuth();
  const gate = await requireAccountAcceptance(user.id);
  if (!gate.ok) {
    throw gate.reason === "verification_failed"
      ? new PolicyAcceptanceVerificationError(gate.error)
      : new PolicyAcceptanceRequiredError(gate.error);
  }
  return user;
}

export { ACCEPTANCE_REQUIRED_REDIRECT };
