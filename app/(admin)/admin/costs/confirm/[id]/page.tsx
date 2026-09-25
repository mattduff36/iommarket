export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { isCostOwner, isCostsEnabled } from "@/lib/costs/config";
import { formatMarkedGbp } from "@/lib/costs/format";
import { costDb } from "@/lib/costs/db";
import { ConfirmInvoiceForm } from "./confirm-form";

export const metadata: Metadata = { title: "Confirm invoice | Admin" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ConfirmProjectInvoicePage({ params }: Props) {
  const admin = await requireRole("ADMIN");
  const { id } = await params;
  if (!isCostsEnabled()) notFound();

  const request = await costDb.invoiceRequest.findUnique({
    where: { id },
  });
  if (!request) notFound();

  const amountLabel = formatMarkedGbp(request.frozenGbpMinor);
  const owner = isCostOwner(admin.authUserId);

  return (
    <div className="max-w-2xl">
      <AdminPageHeader
        title="Confirm invoice request"
        description={`Confirming acknowledges that you will raise an invoice for ${amountLabel}. This deducts that frozen amount from the live outstanding total.`}
        meta={
          <Badge variant={request.status === "CONFIRMED" ? "success" : "warning"}>
            {request.status}
          </Badge>
        }
      />
      <section className="rounded-lg border border-border bg-surface p-4 shadow-low sm:p-6">
        {request.status === "PENDING" && owner ? (
          <ConfirmInvoiceForm requestId={request.id} amountLabel={amountLabel} />
        ) : null}
        {request.status === "PENDING" && !owner ? (
          <p className="text-sm leading-6 text-text-secondary">
            Only the configured owner can confirm this request.
          </p>
        ) : null}
        {request.status === "CONFIRMED" ? (
          <p className="text-sm leading-6 text-text-secondary">
            This request has already been confirmed.
          </p>
        ) : null}
      </section>
    </div>
  );
}
