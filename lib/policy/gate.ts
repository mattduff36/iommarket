import { redirect } from "next/navigation";
import { getCurrentUser, requireAuth } from "@/lib/auth";
import {
  ACCEPTANCE_REQUIRED_REDIRECT,
  requireAccountAcceptance,
} from "@/lib/policy/acceptance";

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
    throw new Error(gate.error);
  }
  return user;
}

export { ACCEPTANCE_REQUIRED_REDIRECT };
