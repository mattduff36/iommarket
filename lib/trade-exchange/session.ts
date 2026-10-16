import {
  AccountDisabledError,
  AuthenticationRequiredError,
  InsufficientPermissionsError,
  OnboardingIncompleteError,
} from "@/lib/auth";
import {
  PolicyAcceptanceRequiredError,
  PolicyAcceptanceVerificationError,
  requireAcceptedAuth,
} from "@/lib/policy/gate";
import { resolveTradeActor } from "@/lib/trade-exchange/access";
import type { TradeActor, TradeDealerSubject } from "@/lib/trade-exchange/decision";

export async function loadTradeSession(): Promise<{ actor: TradeActor; email: string | null }> {
  try {
    const user = await requireAcceptedAuth();
    const subject: TradeDealerSubject = {
      id: user.id,
      role: user.role,
      disabledAt: user.disabledAt,
      deletedAt: user.deletedAt,
      dealerProfile: user.dealerProfile
        ? { id: user.dealerProfile.id, name: user.dealerProfile.name, tier: user.dealerProfile.tier }
        : null,
    };
    return { actor: await resolveTradeActor(subject), email: user.email };
  } catch (error) {
    if (
      error instanceof AuthenticationRequiredError ||
      error instanceof AccountDisabledError ||
      error instanceof InsufficientPermissionsError ||
      error instanceof PolicyAcceptanceRequiredError ||
      error instanceof PolicyAcceptanceVerificationError ||
      error instanceof OnboardingIncompleteError
    ) {
      return { actor: { kind: "anonymous" }, email: null };
    }
    throw error;
  }
}
