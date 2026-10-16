import { notFound } from "next/navigation";
import { decideTradeMembershipAction } from "@/actions/trade/admin";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  TradeAccessFacts,
  TradeBackLink,
  TRADE_DECISION_OPTIONS,
  TradeFactList,
  TradeMembershipBadge,
  TradeReviewSection,
  tradeCodeLabel,
  tradeEntityLabel,
} from "@/components/admin/trade-admin-ui";
import { TradeForm, tradeFieldClass } from "@/components/trade/trade-form";
import { formatAdminDate } from "@/lib/admin/format";
import { db } from "@/lib/db";
import { TRADE_REASON_CODES } from "@/lib/trade-exchange/constants";
import { hasTradeProEntitlement } from "@/lib/trade-exchange/entitlement";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";

export const dynamic = "force-dynamic";

function safeWebsite(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return value;
    return (
      <a href={url.toString()} className="text-text-primary underline-offset-4 hover:underline" rel="noreferrer">
        {url.toString()}
      </a>
    );
  } catch {
    return value;
  }
}

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
      evidenceFileName: true,
      reasonCode: true,
      reviewNote: true,
      reviewedAt: true,
      submittedAt: true,
      dealer: {
        select: {
          verified: true,
          tier: true,
          subscriptions: {
            select: {
              source: true,
              status: true,
              currentPeriodEnd: true,
              grantStartsAt: true,
              grantEndsAt: true,
              revokedAt: true,
              providerPlanId: true,
            },
          },
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { id: true, fromStatus: true, toStatus: true, reasonCode: true, note: true, createdAt: true },
      },
    },
  });
  if (!application) notFound();
  const proActive = hasTradeProEntitlement({
    tier: application.dealer.tier,
    subscriptions: application.dealer.subscriptions,
  });

  return (
    <section className="max-w-3xl">
      <AdminPageHeader
        title={application.businessName}
        description="Review the business, then record a decision. Public verification, Trade approval and Pro stay separate."
        meta={
          <>
            <span>Submitted {formatAdminDate(application.submittedAt)}</span>
            {application.reviewedAt ? <span>Last reviewed {formatAdminDate(application.reviewedAt)}</span> : null}
          </>
        }
        actions={<TradeBackLink href="/admin/trade/applications">Applications</TradeBackLink>}
      />
      {application.duplicateRegistration ? (
        <p role="status" className="mb-4 rounded-lg border border-premium-gold-500/30 bg-premium-gold-500/10 px-3 py-2 text-sm text-text-primary">
          This registration identifier is already used. Check it manually before approving.
        </p>
      ) : null}
      <TradeAccessFacts verified={application.dealer.verified} status={application.status} proActive={proActive} />
      <TradeReviewSection title="Business">
        <TradeFactList
          items={[
            { label: "Trading name", value: application.businessName },
            { label: "Legal entity", value: application.legalEntityName },
            { label: "Type", value: tradeEntityLabel(application.entityType) },
            { label: "Registration", value: application.registrationIdentifier },
            { label: "Address", value: application.tradingAddress },
            { label: "Website", value: safeWebsite(application.website) },
            { label: "Activity", value: application.activityDescription },
          ]}
        />
      </TradeReviewSection>
      <TradeReviewSection title="Contact">
        <TradeFactList
          items={[
            { label: "Contact", value: application.contactName },
            { label: "Role", value: application.roleDeclaration },
            { label: "Work email", value: application.workEmail },
            { label: "Phone", value: application.phone },
          ]}
        />
      </TradeReviewSection>
      <TradeReviewSection title="Evidence">
        {application.evidenceFileId ? (
          <p className="text-sm leading-6 text-text-secondary">
            <a
              href={`/api/trade/evidence/${application.id}`}
              className="font-medium text-text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500"
            >
              Download protected evidence{application.evidenceFileName ? ` (${application.evidenceFileName})` : ""}
            </a>
            . Staff downloads stay private and are recorded. The file is not published.
          </p>
        ) : (
          <AdminEmptyState compact title="No evidence file" description="The applicant did not attach a document." />
        )}
      </TradeReviewSection>
      <TradeReviewSection title="Decision">
        {application.reviewedAt ? (
          <p className="mb-4 text-sm text-text-secondary">
            Current status <TradeMembershipBadge status={application.status} />
            {application.reasonCode ? ` · ${tradeCodeLabel(application.reasonCode)}` : ""}
            {application.reviewNote ? ` · ${application.reviewNote}` : ""}
          </p>
        ) : (
          <p className="mb-4 text-sm text-text-secondary">No decision has been saved yet. Choose one before saving.</p>
        )}
        <TradeForm action={decideTradeMembershipAction} submitLabel="Save decision" successMessage="Decision saved.">
          <input type="hidden" name="membershipId" value={application.id} />
          <label htmlFor="trade-decision" className="flex flex-col gap-1 text-sm font-medium text-text-primary">
            Decision
            <select id="trade-decision" name="decision" required defaultValue="" className={tradeFieldClass}>
              <option value="">Choose a decision</option>
              {TRADE_DECISION_OPTIONS.map((decision) => (
                <option key={decision.value} value={decision.value}>{decision.label}</option>
              ))}
            </select>
          </label>
          <label htmlFor="trade-reason" className="flex flex-col gap-1 text-sm font-medium text-text-primary">
            Reason
            <select id="trade-reason" name="reasonCode" defaultValue="" className={tradeFieldClass}>
              <option value="">None</option>
              {TRADE_REASON_CODES.map((reason) => (
                <option key={reason} value={reason}>{tradeCodeLabel(reason)}</option>
              ))}
            </select>
            <span className="font-normal text-text-secondary">Required unless the decision is Approve.</span>
          </label>
          <label htmlFor="trade-note" className="flex flex-col gap-1 text-sm font-medium text-text-primary">
            Internal note
            <textarea id="trade-note" name="note" rows={3} className={tradeFieldClass} />
          </label>
        </TradeForm>
      </TradeReviewSection>
      <TradeReviewSection title="History">
        {application.events.length === 0 ? (
          <AdminEmptyState compact title="No history yet" description="Status changes are recorded here." />
        ) : (
          <ol className="divide-y divide-border rounded-lg border border-border">
            {application.events.map((event) => (
              <li key={event.id} className="px-4 py-3 text-sm">
                <p className="text-text-primary">
                  <time dateTime={event.createdAt.toISOString()}>{formatAdminDate(event.createdAt)}</time>
                  {" · "}
                  {event.fromStatus ? <TradeMembershipBadge status={event.fromStatus} /> : "New"}
                  {" → "}
                  <TradeMembershipBadge status={event.toStatus} />
                </p>
                {event.reasonCode || event.note ? (
                  <p className="mt-1 text-text-secondary">
                    {event.reasonCode ? tradeCodeLabel(event.reasonCode) : null}
                    {event.reasonCode && event.note ? " · " : null}
                    {event.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </TradeReviewSection>
    </section>
  );
}
