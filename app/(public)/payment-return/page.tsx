export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { CheckCircle2, CircleSlash2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentReturnActions } from "@/components/payments/payment-return-actions";

export const metadata: Metadata = {
  title: "Return to itrader",
  description:
    "Close the hosted payment tab and continue in your original itrader tab.",
};

interface Props {
  searchParams: Promise<{
    status?: "success" | "cancel";
    context?: "listing" | "featured" | "subscription";
    returnTo?: string;
    listing?: string;
  }>;
}

export function isSafeInternalReturnHref(
  returnTo: string | undefined
): returnTo is `/${string}` {
  return Boolean(returnTo && /^\/(?!\/)/.test(returnTo));
}

export function resolveReturnHref(
  returnTo: string | undefined,
  context: "listing" | "featured" | "subscription" | undefined,
  listingId: string | undefined
): string {
  if (isSafeInternalReturnHref(returnTo)) {
    return returnTo;
  }

  if (context === "featured" && listingId) {
    return `/listings/${listingId}`;
  }

  if (context === "subscription") {
    return "/dealer/dashboard";
  }

  return listingId ? `/sell/checkout?listing=${listingId}` : "/";
}

function getPaymentReturnCopy(
  status: "success" | "cancel",
  context: "listing" | "featured" | "subscription"
) {
  if (status === "success") {
    if (context === "listing") {
      return {
        title: "Payment successful",
        message:
          "Your hosted payment is complete. Return to the original itrader tab to see the listing draft update and continue from the saved checkout screen.",
      };
    }

    if (context === "featured") {
      return {
        title: "Featured payment successful",
        message:
          "Your featured upgrade payment completed successfully. Return to itrader to refresh the listing and confirm the upgrade.",
      };
    }

    return {
      title: "Subscription payment successful",
      message:
        "Your subscription checkout completed successfully. Return to itrader to refresh the dealer dashboard and continue onboarding.",
    };
  }

  if (context === "listing") {
    return {
      title: "Payment cancelled",
      message:
        "The hosted payment was cancelled. Your original itrader tab is still open and your saved listing draft is waiting there for you.",
    };
  }

  if (context === "featured") {
    return {
      title: "Featured payment cancelled",
      message:
        "The featured upgrade checkout was cancelled. Return to itrader to reopen payment or keep managing the listing.",
    };
  }

  return {
    title: "Subscription payment cancelled",
    message:
      "The subscription checkout was cancelled. Return to itrader to choose a plan or restart payment when ready.",
  };
}

export default async function PaymentReturnPage({ searchParams }: Props) {
  const sp = await searchParams;
  const status = sp.status === "cancel" ? "cancel" : "success";
  const context = sp.context ?? "listing";
  const returnHref = resolveReturnHref(sp.returnTo, context, sp.listing);
  const copy = getPaymentReturnCopy(status, context);
  const Icon = status === "success" ? CheckCircle2 : CircleSlash2;

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 lg:px-8">
      <Card>
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-neon-blue-500/20 bg-neon-blue-500/10">
            <Icon
              className={`h-7 w-7 ${
                status === "success" ? "text-emerald-400" : "text-text-secondary"
              }`}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neon-blue-400">
              Hosted Checkout
            </p>
            <CardTitle>{copy.title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm leading-6 text-text-secondary">{copy.message}</p>

          <div className="rounded-lg border border-border bg-surface/60 p-4 text-sm text-text-secondary">
            <div className="flex items-start gap-2">
              <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-neon-blue-400" />
              <p>
                You can safely close this payment tab after returning to itrader.
                The original tab remains the source of truth for your listing or
                account flow.
              </p>
            </div>
          </div>

          <PaymentReturnActions
            returnHref={returnHref}
            status={status}
            context={context}
            listingId={sp.listing}
          />
        </CardContent>
      </Card>
    </div>
  );
}
