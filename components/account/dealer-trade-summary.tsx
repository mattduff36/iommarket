import Link from "@/components/navigation/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TradeActor } from "@/lib/trade-exchange/decision";
import { tradeMembershipLabel } from "@/lib/trade-exchange/listings";

export type TradeDashboardActor = Extract<TradeActor, { kind: "member" | "applicant" }>;

export function DealerTradeExchangeCard({
  actor,
  summary,
}: {
  actor: TradeDashboardActor;
  summary: { live: number; drafts: number; enquiries: number; stale: number } | null;
}) {
  const proActive = actor.kind === "member" || actor.proEntitled;
  const approval = actor.kind === "member" ? "Approved" : tradeMembershipLabel(actor.membershipStatus);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="font-heading">Trade Exchange</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-text-secondary">
          Part-exchange and clearance stock for approved dealers. Trade stock stays off the public marketplace.
        </p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-text-secondary">Dealer Pro</dt>
            <dd className="mt-1">
              <Badge variant={proActive ? "success" : "warning"}>{proActive ? "Active" : "Not active"}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-text-secondary">Trade approval</dt>
            <dd className="mt-1">
              <Badge variant={approval === "Approved" ? "success" : approval === "In review" ? "warning" : "neutral"}>
                {approval}
              </Badge>
            </dd>
          </div>
        </dl>
        {actor.kind === "member" && summary ? (
          <p className="text-sm text-text-secondary">
            {summary.live} live, {summary.drafts} drafts, {summary.enquiries} open enquiries, {summary.stale} due for an availability check.
          </p>
        ) : null}
        <Button asChild size="sm" variant="ghost">
          <Link href="/dealer/trade">Open Trade Exchange</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
