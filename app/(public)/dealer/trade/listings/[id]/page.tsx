import Link from "next/link";
import { notFound } from "next/navigation";
import { removeTradePhotoAction, reportTradeListingAction, uploadTradePhotoAction } from "@/actions/trade/listings";
import { sendTradeEnquiryAction } from "@/actions/trade/enquiries";
import { TradeForm, tradeFieldClass } from "@/components/trade/trade-form";
import { TradeListingActions } from "@/components/trade/status-actions";
import { TradeNav } from "@/components/trade/trade-nav";
import { Button } from "@/components/ui/button";
import { TRADE_REPORT_REASONS } from "@/lib/trade-exchange/constants";
import { getVisibleTradeListing } from "@/lib/trade-exchange/listings";
import { formatTradePrice, presentTradeListing } from "@/lib/trade-exchange/presenter";
import { loadTradeSession } from "@/lib/trade-exchange/session";

export default async function TradeListingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member" && session.actor.kind !== "admin") notFound();
  const { id } = await params;
  const listing = await getVisibleTradeListing(session.actor, id);
  if (!listing) notFound();
  const view = presentTradeListing(listing, {
    dealerId: session.actor.kind === "member" ? session.actor.dealerId : undefined,
    admin: session.actor.kind === "admin",
  }, { includeIdentity: true });
  const showPhone = view.ownsListing || view.contactPreference !== "MESSAGE";
  const phone = showPhone ? listing.dealer?.phone : null;
  const ownerActions = view.status === "DRAFT" || view.status === "EXPIRED"
    ? [{ status: "LIVE" as const, label: view.status === "DRAFT" ? "Publish" : "Confirm still available" }]
    : view.status === "LIVE"
      ? [{ status: "RESERVED" as const, label: "Reserve" }, { status: "SOLD" as const, label: "Mark sold" }, { status: "WITHDRAWN" as const, label: "Withdraw" }]
      : view.status === "RESERVED"
        ? [{ status: "LIVE" as const, label: "Return to live" }, { status: "SOLD" as const, label: "Mark sold" }, { status: "WITHDRAWN" as const, label: "Withdraw" }]
        : [];

  return (
    <article>
      <TradeNav />
      <p className="text-sm text-text-secondary">{view.dealerName} · {view.locationLabel} · {view.status}</p>
      <h1 className="mt-1 text-3xl font-bold text-text-primary">{view.year} {view.make} {view.model}</h1>
      <p className="mt-2 text-lg text-text-primary">{formatTradePrice(view)} · {view.vatTreatment.replaceAll("_", " ")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {view.images.map((image) => (
          // Private trade photos are authorised per request.
          // eslint-disable-next-line @next/next/no-img-element
          <img key={image.id} src={`/api/trade/images/${image.id}`} alt="" className="aspect-[16/10] w-full rounded-lg object-cover" />
        ))}
      </div>
      <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-text-secondary">Mileage</dt><dd>{view.mileage.toLocaleString("en-GB")} miles</dd></div>
        <div><dt className="text-text-secondary">Transmission</dt><dd>{view.transmission}</dd></div>
        <div><dt className="text-text-secondary">Fuel</dt><dd>{view.fuel}</dd></div>
        <div><dt className="text-text-secondary">Condition</dt><dd>{view.conditionSummary}</dd></div>
        <div className="sm:col-span-2"><dt className="text-text-secondary">Defects</dt><dd>{view.disclosedDefects}</dd></div>
        {view.serviceHistory ? <div className="sm:col-span-2"><dt className="text-text-secondary">Service history</dt><dd>{view.serviceHistory}</dd></div> : null}
        {view.motStatus ? <div><dt className="text-text-secondary">MOT or test</dt><dd>{view.motStatus}</dd></div> : null}
        {view.notes ? <div className="sm:col-span-2"><dt className="text-text-secondary">Notes</dt><dd>{view.notes}</dd></div> : null}
        {view.registrationNumber ? <div><dt className="text-text-secondary">Registration</dt><dd>{view.registrationNumber}</dd></div> : null}
        {view.vin ? <div><dt className="text-text-secondary">VIN</dt><dd>{view.vin}</dd></div> : null}
        {phone ? <div><dt className="text-text-secondary">Phone</dt><dd>{phone}</dd></div> : null}
      </dl>
      {view.ownsListing && session.actor.kind === "member" ? (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap gap-3">
            <Link className="text-sm underline" href={`/dealer/trade/listings/${view.id}/edit`}>Edit</Link>
          </div>
          <TradeListingActions listingId={view.id} actions={ownerActions} />
          <TradeForm action={uploadTradePhotoAction.bind(null, view.id)} submitLabel="Add photo">
            <label className="text-sm font-medium text-text-primary">Photo
              <input className="mt-1 block text-sm" type="file" name="photo" accept="image/jpeg,image/png,image/webp" required />
            </label>
          </TradeForm>
          {view.images.map((image) => (
            <form key={image.id} action={async () => { await removeTradePhotoAction(image.id); }}>
              <Button type="submit" variant="ghost">Remove photo {image.id.slice(-4)}</Button>
            </form>
          ))}
        </div>
      ) : null}
      {!view.ownsListing && session.actor.kind === "member" && view.status === "LIVE" ? (
        <div className="mt-8 max-w-xl space-y-6">
          <h2 className="text-xl font-semibold text-text-primary">Enquire or offer</h2>
          <p className="text-sm text-text-secondary">An accepted offer is not a completed sale. Agree the transfer with the other dealer off the platform.</p>
          <TradeForm action={sendTradeEnquiryAction} submitLabel="Send enquiry">
            <input type="hidden" name="listingId" value={view.id} />
            <label className="flex flex-col gap-1 text-sm font-medium">Message
              <textarea name="body" required rows={4} className={tradeFieldClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">Optional offer (£)
              <input name="offerGbp" inputMode="decimal" className={tradeFieldClass} />
            </label>
          </TradeForm>
          <h2 className="text-xl font-semibold text-text-primary">Report this listing</h2>
          <TradeForm action={reportTradeListingAction} submitLabel="Submit report">
            <input type="hidden" name="listingId" value={view.id} />
            <label className="flex flex-col gap-1 text-sm font-medium">Reason
              <select name="reasonCode" className={tradeFieldClass} defaultValue="MISLEADING">
                {TRADE_REPORT_REASONS.map((reason) => <option key={reason} value={reason}>{reason.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">Details
              <textarea name="details" required minLength={2} rows={3} className={tradeFieldClass} />
            </label>
          </TradeForm>
        </div>
      ) : null}
    </article>
  );
}
