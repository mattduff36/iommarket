export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { isCostOwner, isCostsEnabled } from "@/lib/costs/config";
import { formatMarkedGbp } from "@/lib/costs/format";
import { db } from "@/lib/db";
import { ConfirmInvoiceForm } from "./confirm-form";

export const metadata: Metadata = { title: "Confirm invoice | Admin" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ConfirmProjectInvoicePage({ params }: Props) {
  const admin = await requireRole("ADMIN");
  const { id } = await params;
  if (!isCostsEnabled()) notFound();

  const request = await db.invoiceRequest.findUnique({
    where: { id },
  });
  if (!request) notFound();

  const amountLabel = formatMarkedGbp(request.frozenGbpMinor);
  const owner = isCostOwner(admin.authUserId);

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-6">
        Confirm invoice request
      </h1>
      <p className="mb-4 text-text-secondary">
        Confirming acknowledges that you will raise an invoice for {amountLabel}.
        This deducts that frozen amount from the live outstanding total.
      </p>
      <div className="mb-6">
        <Badge variant={request.status === "CONFIRMED" ? "success" : "warning"}>
          {request.status}
        </Badge>
      </div>
      {request.status === "PENDING" && owner ? (
        <ConfirmInvoiceForm requestId={request.id} amountLabel={amountLabel} />
      ) : null}
      {request.status === "PENDING" && !owner ? (
        <p className="text-sm text-text-secondary">
          Only the configured owner can confirm this request.
        </p>
      ) : null}
      {request.status === "CONFIRMED" ? (
        <p className="text-sm text-text-secondary">
          This request has already been confirmed.
        </p>
      ) : null}
    </>
  );
}
