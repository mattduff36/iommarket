"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { requestDealerCancellation } from "@/actions/dealer/cancellation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  enabled: boolean;
  periodEndAt?: Date | null;
  existingStatus?: string | null;
}

export function CancellationRequestCard({
  enabled,
  periodEndAt,
  existingStatus,
}: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!enabled && !existingStatus) return null;

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>Cancel subscription</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {existingStatus ? (
          <p className="text-sm text-text-secondary">
            Your cancellation request is {existingStatus.toLowerCase()}. Access
            stays active until{" "}
            {periodEndAt
              ? periodEndAt.toLocaleDateString("en-GB")
              : "the end of the paid period"}
            . Refunds are not pro-rated. See the{" "}
            <Link href="/refunds" className="text-text-trust hover:underline">
              Refund Policy
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              Request end-of-period cancellation. You keep dealer access until
              the paid period ends. We cannot cancel Ripple immediately from
              this site, and refunds are not pro-rated. See the{" "}
              <Link href="/refunds" className="text-text-trust hover:underline">
                Refund Policy
              </Link>
              .
            </p>
            <Checkbox
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
              label="I understand this is an end-of-period request with no pro-rata refund"
            />
            {error ? <p className="text-sm text-text-error">{error}</p> : null}
            <Button
              type="button"
              variant="energy"
              size="sm"
              loading={isPending}
              disabled={!confirmed}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await requestDealerCancellation({
                    confirmation: confirmed,
                  });
                  if (result.error) {
                    setError(
                      typeof result.error === "string"
                        ? result.error
                        : "Could not submit the cancellation request.",
                    );
                  }
                });
              }}
            >
              Request cancellation
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
