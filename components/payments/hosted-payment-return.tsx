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
    title: "Payment result not confirmed",
    message: "We haven't confirmed the payment result yet. Check payment status before paying again.",
    detail: "Return to your listings and review the payment. If you see a charge or a receipt, contact us before paying again.",
    Icon: TriangleAlert,
  },
  cancelled: {
    title: "Payment result not confirmed",
    message: "Leaving checkout does not confirm a cancellation. Check payment status before paying again.",
    detail: "Return to your listings and review the payment before starting another one.",
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
