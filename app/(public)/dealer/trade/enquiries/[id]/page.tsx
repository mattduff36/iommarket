import { notFound } from "next/navigation";
import { replyTradeEnquiryAction } from "@/actions/trade/enquiries";
import { TradeForm } from "@/components/trade/trade-form";
import { tradeFieldClass } from "@/components/trade/trade-styles";
import { TradeEnquiryActions } from "@/components/trade/status-actions";
import { TradeNav } from "@/components/trade/trade-nav";
import { canTransitionTradeEnquiry } from "@/lib/trade-exchange/lifecycle";
import { getTradeEnquiry } from "@/lib/trade-exchange/enquiries";
import { loadTradeSession } from "@/lib/trade-exchange/session";

export default async function TradeEnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member" && session.actor.kind !== "admin") notFound();
  const { id } = await params;
  const enquiry = await getTradeEnquiry(session.actor, id);
  if (!enquiry) notFound();
  const dealerId = session.actor.kind === "member" ? session.actor.dealerId : "";
  const role = session.actor.kind === "admin" ? "admin" : dealerId === enquiry.fromDealerId ? "enquirer" : "listing-owner";
  const actions = (["WITHDRAWN", "DECLINED", "ACCEPTED_IN_PRINCIPLE", "CLOSED"] as const)
    .filter((status) => canTransitionTradeEnquiry(enquiry.status, status, role))
    .map((status) => ({ status, label: status.replaceAll("_", " ").toLowerCase() }));
  return (
    <section className="max-w-2xl">
      <TradeNav />
      <h1 className="text-3xl font-bold text-text-primary">{enquiry.listing.year} {enquiry.listing.make} {enquiry.listing.model}</h1>
      <p className="mt-2 text-sm text-text-secondary">{enquiry.fromDealer.name} to {enquiry.toDealer.name} · {enquiry.status}</p>
      <p className="mt-2 text-sm text-text-secondary">Accepting an offer records interest only. It is not a processed sale.</p>
      <ol className="mt-6 space-y-3">
        {enquiry.messages.map((message) => (
          <li key={message.id} className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-text-primary">{message.sender.name}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{message.body}</p>
          </li>
        ))}
      </ol>
      {session.actor.kind === "member" ? (
        <div className="mt-6 space-y-4">
          <TradeEnquiryActions enquiryId={enquiry.id} actions={actions} />
          <TradeForm action={replyTradeEnquiryAction.bind(null, enquiry.id)} submitLabel="Send reply">
            <label className="flex flex-col gap-1 text-sm font-medium">Reply
              <textarea name="body" required rows={4} className={tradeFieldClass} />
            </label>
          </TradeForm>
        </div>
      ) : null}
    </section>
  );
}
