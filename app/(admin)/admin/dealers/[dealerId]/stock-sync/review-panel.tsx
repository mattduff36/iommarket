import { formatGbpFromPence } from "@/lib/formatting/gbp";
import type { PlanAction, ReviewedActionEvidence } from "@/lib/dealer-stock-sync/types";
import { actionLabel, stockSyncReason, stockSyncStatus } from "@/lib/dealer-stock-sync/review";
import { ApproveStockReportButton } from "./approve-button";

function changesFor(action: PlanAction) {
  if (action.kind !== "update" && action.kind !== "conflict" && action.kind !== "create") return [];
  return action.changes;
}

function isSold(action: PlanAction) {
  const review = action.review;
  return action.kind === "blocked" && (
    action.reason === "sold-exclude-from-live-import" ||
    review?.availability === "sold" ||
    Boolean(review?.flags.includes("sold-exclude-from-live-import"))
  );
}

function safeHttps(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return url;
  } catch {
    return null;
  }
}

function priceText(pence: number | null | undefined) {
  return pence == null ? "No price" : formatGbpFromPence(pence);
}

function Evidence({ review }: { review: ReviewedActionEvidence }) {
  const photo = review.safePhotoUrls.map((url) => safeHttps(url)).find((url) => url != null) ?? null;
  const source = safeHttps(review.sourceUrl);
  return (
    <div className="mt-2 flex gap-3">
      {photo ? (
        <a href={photo} target="_blank" rel="noreferrer" aria-label={`View photo of ${review.displayTitle}`}>
          <img src={photo} alt={review.displayTitle} loading="lazy" className="h-16 w-24 rounded-md object-cover" />
        </a>
      ) : null}
      <div className="text-text-secondary">
        <p>
          {review.year ?? "Year unknown"} · {review.categorySlug ?? "Category unknown"} · {priceText(review.pricePence)} ·{" "}
          {review.mileage == null ? "Mileage unknown" : `${review.mileage.toLocaleString("en-GB")} miles`}
        </p>
        <p>{review.fuel ?? "Fuel unknown"} · {review.transmission ?? "Transmission unknown"}</p>
        {review.flags.length > 0 ? <p>Checks needed: {review.flags.map(stockSyncReason).join("; ")}</p> : null}
        {source ? (
          <a href={source} target="_blank" rel="noreferrer" className="text-neon-blue-400 hover:underline">
            Source listing
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Row({ action }: { action: PlanAction }) {
  return (
    <li className="rounded-md border border-border px-3 py-2 text-sm">
      <p className="font-medium text-text-primary">
        {actionLabel(action)}
        {action.displayTitle ? ` - ${action.displayTitle}` : ""}
      </p>
      {action.kind === "blocked" || action.kind === "conflict" ? (
        <p className="text-text-secondary">{stockSyncReason(action.reason)}</p>
      ) : null}
      {action.kind === "missing_once" || action.kind === "unpublish" ? (
        <p className="text-text-secondary">Missing from {action.absenceCount} complete checks</p>
      ) : null}
      {action.kind === "create" ? (
        <p className="text-text-secondary">
          {action.categorySlug} · {priceText(action.pricePence)}
          {action.attributes.mileage ? ` · ${Number(action.attributes.mileage).toLocaleString("en-GB")} miles` : ""}
          {action.attributes.year ? ` · ${action.attributes.year}` : ""}
        </p>
      ) : null}
      {changesFor(action).map((change) => (
        <p key={change.field} className="text-text-secondary">
          {change.field === "price" ? "Price" : "Mileage"}: {change.before == null ? "Not listed" : change.field === "price" ? formatGbpFromPence(change.before) : change.before.toLocaleString("en-GB")} to {change.after == null ? "Not listed" : change.field === "price" ? formatGbpFromPence(change.after) : change.after.toLocaleString("en-GB")}
        </p>
      ))}
      {action.review ? <Evidence review={action.review} /> : null}
    </li>
  );
}

export function StockSyncReviewPanel(input: {
  reportId: string;
  status: string;
  fingerprint: string;
  failureReason: string | null;
  actions: PlanAction[];
}) {
  const sold = input.actions.filter(isSold);
  const actionable = input.actions.filter((action) => action.kind === "create" || action.kind === "update");
  const blocked = input.actions.filter((action) =>
    (action.kind === "blocked" || action.kind === "conflict") && !isSold(action));
  const missing = input.actions.filter((action) => action.kind === "missing_once");
  const unpublish = input.actions.filter((action) => action.kind === "unpublish");
  const summary = input.actions.find((action) => action.review)?.review ?? null;
  const groups = [
    ["Eligible additions and changes", [...actionable]],
    ["Sold excluded", sold],
    ["Blocked", blocked],
    ["Missing once", missing],
    ["Proposed unpublish", unpublish],
  ] as const;
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-text-primary">Latest review</h2>
      <p className="text-sm text-text-secondary">
        Status: {stockSyncStatus(input.status)}. {actionable.length} actionable, {blocked.length} blocked, {sold.length} sold excluded.
        Approving queues processing. It does not publish listings immediately.
      </p>
      {summary ? (
        <div className="rounded-md border border-border bg-surface-secondary px-4 py-3 text-sm text-text-secondary">
          <p>Saved scan captured {new Date(summary.capturedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}.</p>
          {summary.coverageWarning ? <p role="status">{summary.coverageWarning}</p> : null}
          {summary.capacityWarning ? <p role="status">{summary.capacityWarning}</p> : null}
        </div>
      ) : null}
      {input.failureReason ? (
        <p className="text-sm text-text-error" role="alert">
          Check incomplete: {stockSyncReason(input.failureReason)} Missing vehicles have not been counted.
        </p>
      ) : null}
      {groups.map(([title, actions]) => (
        <div key={title}>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">{title}</h3>
          {actions.length === 0 ? (
            <p className="text-sm text-text-tertiary">None</p>
          ) : (
            <ul className="space-y-2">
              {actions.map((action, index) => (
                <Row key={`${action.kind}-${action.sourceIdentityKey ?? "none"}-${index}`} action={action} />
              ))}
            </ul>
          )}
        </div>
      ))}
      {input.status === "PENDING_REVIEW" ? (
        <ApproveStockReportButton reportId={input.reportId} fingerprint={input.fingerprint} />
      ) : null}
    </section>
  );
}
