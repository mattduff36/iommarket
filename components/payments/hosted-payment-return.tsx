import Link from "next/link";
import type { ReactNode } from "react";
import { CircleSlash2, Clock3, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const outcomes = {
  success: {
    title: "You're back from checkout",
    message: "Your payment still needs to be confirmed on itrader. If your payment provider showed a successful payment, please do not pay again.",
    detail: "You can return to your listings and continue editing your saved draft. If payment confirmation is still missing, our team can help link the payment to your listing.",
    Icon: Clock3,
  },
  failed: {
    title: "Your payment wasn't completed",
    message: "Checkout returned an unsuccessful result. Your saved listing draft and photos are still available.",
    detail: "Return to your listings to review the payment status before trying again. If you see a charge or received a payment receipt, contact us first to avoid paying twice.",
    Icon: TriangleAlert,
  },
  cancelled: {
    title: "You left checkout",
    message: "You can pick up where you left off. Your saved listing draft and photos are still available.",
    detail: "Return to your listings whenever you're ready. If you completed a payment before leaving checkout, check its status or contact us before paying again.",
    Icon: CircleSlash2,
  },
} as const;

// Browser return data is not proof of payment; confirmation is server-verified.
export function HostedPaymentReturn({ outcome, children }: { outcome: keyof typeof outcomes; children?: ReactNode }) {
  const { title, message, detail, Icon } = outcomes[outcome];

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6 lg:py-24">
      <Card>
        <CardHeader className="items-center gap-4 text-center">
          <div className="rounded-full border border-neon-blue-500/20 bg-neon-blue-500/10 p-4">
            <Icon aria-hidden="true" className="h-7 w-7 text-neon-blue-400" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-text-secondary">itrader checkout</p>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        </CardHeader>
        <CardContent className="space-y-6">
          {children ?? <>
            <p className="text-center text-sm leading-6 text-text-secondary">{message}</p>
            <p className="rounded-lg border border-border bg-surface/60 p-4 text-sm leading-6 text-text-secondary">{detail}</p>
          </>}
          <div className="flex flex-col gap-3">
            <Button asChild><Link href="/account/listings">Return to my listings</Link></Button>
            <Button asChild variant="ghost"><Link href="/dealer/dashboard">Manage dealer account</Link></Button>
            <Link href="/contact" className="text-center text-sm text-neon-blue-400 underline underline-offset-4">Get help with a payment</Link>
          </div>
          <p className="text-center text-xs leading-5 text-text-secondary">You may be asked to sign in to access your listings or account.</p>
        </CardContent>
      </Card>
    </div>
  );
}
