import type { UserRole } from "@prisma/client";
import { AccountShell } from "@/components/account/account-shell";
import { getCurrentUser } from "@/lib/auth";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";

const SAFE_DEALER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

function safeDealerSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const trimmed = slug.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return null;
  return SAFE_DEALER_SLUG.test(trimmed) ? trimmed : null;
}

function displayName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}

export async function AccountArea({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) return children;

  const role: UserRole = user.role;

  return (
    <AccountShell
      role={role}
      name={displayName(user.name)}
      dealerSlug={safeDealerSlug(user.dealerProfile?.slug)}
      tradeEnabled={isTradeExchangeEnabled()}
    >
      {children}
    </AccountShell>
  );
}
