import { notFound } from "next/navigation";
import { decideTradeMembershipAction } from "@/actions/trade/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { TradeForm, tradeFieldClass } from "@/components/trade/trade-form";
import { db } from "@/lib/db";
import { TRADE_REASON_CODES } from "@/lib/trade-exchange/constants";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";

export default async function AdminTradeApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isTradeExchangeEnabled()) notFound();
  const { id } = await params;
  const application = await db.tradeMembership.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      businessName: true,
      legalEntityName: true,
      entityType: true,
      registrationIdentifier: true,
      tradingAddress: true,
      website: true,
      contactName: true,
      roleDeclaration: true,
      workEmail: true,
      phone: true,
      activityDescription: true,
      duplicateRegistration: true,
      evidenceFileId: true,
      reasonCode: true,
    },
  });
  if (!application) notFound();
  const fields = [
    ["Trading name", application.businessName],
    ["Legal entity", application.legalEntityName],
    ["Type", application.entityType],
    ["Registration", application.registrationIdentifier],
    ["Address", application.tradingAddress],
    ["Website", application.website],
    ["Contact", application.contactName],
    ["Role", application.roleDeclaration],
    ["Work email", application.workEmail],
    ["Phone", application.phone],
    ["Activity", application.activityDescription],
  ] as const;
  return (
    <section className="max-w-3xl">
      <AdminPageHeader title={application.businessName} description={application.status} />
      {application.duplicateRegistration ? <p className="mb-4 text-sm text-text-error">This registration identifier is already used. Check it manually before approving.</p> : null}
      <dl className="space-y-2 text-sm">
        {fields.map(([label, value]) => value ? <div key={label}><dt className="text-text-secondary">{label}</dt><dd>{value}</dd></div> : null)}
      </dl>
      {application.evidenceFileId ? <p className="mt-4 text-sm"><a className="underline" href={`/api/trade/evidence/${application.id}`}>Download evidence</a></p> : <p className="mt-4 text-sm text-text-secondary">No evidence file.</p>}
      <div className="mt-6">
        <TradeForm action={decideTradeMembershipAction} submitLabel="Save decision">
          <input type="hidden" name="membershipId" value={application.id} />
          <label className="flex flex-col gap-1 text-sm font-medium">Decision
            <select name="decision" className={tradeFieldClass} defaultValue="APPROVED">
              {["APPROVED", "NEEDS_INFO", "REJECTED", "SUSPENDED", "REVOKED"].map((decision) => <option key={decision}>{decision}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Reason
            <select name="reasonCode" className={tradeFieldClass} defaultValue="">
              <option value="">None</option>
              {TRADE_REASON_CODES.map((reason) => <option key={reason}>{reason}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Internal note
            <textarea name="note" rows={3} className={tradeFieldClass} />
          </label>
        </TradeForm>
      </div>
    </section>
  );
}
