"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { isSelectableStockAction } from "@/lib/dealer-stock-sync/selection";
import { StockReviewSelectionControls, type StockReviewSelection } from "./review-selection-controls";
import { ReportableError } from "@/components/monitoring/reportable-error";
import { DEALER_PLACEHOLDER_PATH, isDealerPlaceholderImage } from "@/lib/images/dealer-placeholder";
import { stockStatusColour, STOCK_STATUS_BADGE } from "@/lib/dealer-stock-sync/status-colour";
import Link from "@/components/navigation/link";
import { formatGbpFromPence } from "@/lib/formatting/gbp";
import { canEditStockReviewAction } from "@/lib/dealer-stock-sync/review-edit-eligibility";
import type { PlanAction, ReviewedActionEvidence } from "@/lib/dealer-stock-sync/types";
import { actionLabel, stockSyncReason, stockSyncStatus, isSoldStockReviewAction } from "@/lib/dealer-stock-sync/review";
import { StockReviewEditButton } from "./review-edit-button";
import { StockReviewPhoto } from "./review-photo";

function changesFor(action: PlanAction) {
  if (action.kind !== "update" && action.kind !== "conflict" && action.kind !== "create") return [];
  return action.changes;
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
  const photos = [...new Set(review.safePhotoUrls.flatMap(url => {
    const safe = safeHttps(url);
    return safe ? [isDealerPlaceholderImage(safe) ? DEALER_PLACEHOLDER_PATH : safe] : [];
  }))];
  const source = safeHttps(review.sourceUrl);
  return (
    <div className="mt-2 flex gap-3">
      {photos.length > 0 ? <StockReviewPhoto key={JSON.stringify(photos)} photos={photos} title={review.displayTitle} /> : null}
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

function Row({
  action,
  reportId,
  fingerprint,
  allowEdit,
  selected, onSelect,
}: {
  action: PlanAction;
  reportId: string;
  fingerprint: string;
  allowEdit: boolean;
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const editable = allowEdit && canEditStockReviewAction(action);
  const linked = Boolean(action.listingId) && (action.kind === "blocked" || action.kind === "conflict");
  const corrected = action.review?.provenance.includes("admin-corrected") ?? false;
  const label = action.displayTitle || action.review?.displayTitle || "vehicle";
  return (
    <li className={`rounded-lg border p-4 text-sm transition-colors ${selected ? "border-neon-blue-500 bg-neon-blue-500/5" : "border-border"}`}>
      {allowEdit && isSelectableStockAction(action) && <Checkbox className="mb-3 h-9 w-9 rounded-md [&_svg]:h-6 [&_svg]:w-6" label={<span className="flex min-h-10 items-center font-medium">Select {label}</span>} checked={selected} onCheckedChange={value => onSelect(value === true)} />}
      <p className="font-medium text-text-primary">
        <span className={STOCK_STATUS_BADGE + " " + stockStatusColour(action.kind)}>{action.kind === "missing_once" ? "Check availability" : action.kind === "unpublish" ? "Removal suggested" : actionLabel(action)}</span>
        {action.displayTitle ? ` - ${action.displayTitle}` : ""}
      </p>
      {corrected ? <p className="text-text-secondary">Corrected by admin.{allowEdit ? " Still pending approval." : ""}</p> : null}
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
      {editable && action.sourceIdentityKey ? (
        <StockReviewEditButton
          reportId={reportId}
          fingerprint={fingerprint}
          sourceIdentityKey={action.sourceIdentityKey}
          label={label}
          override={action.kind === "blocked"}
        />
      ) : null}
      {linked ? (
        <Link href={`/listings/${action.listingId}?adminReview=1`} className="mt-2 inline-block text-neon-blue-400 hover:underline">
          Open listing editor
        </Link>
      ) : null}
    </li>
  );
}

export function StockSyncReviewPanel(input: {
  reportId: string;
  status: string;
  fingerprint: string;
  failureReason: string | null;
  actions: PlanAction[];
  pendingActions?: PlanAction[];
  selection?: StockReviewSelection;
}) {
  const [localSelection, setLocalSelection] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const selection = input.selection ?? { indexes: localSelection, setIndexes: setLocalSelection };
  const visible = input.actions.filter(action => !isSoldStockReviewAction(action));
  const actionable = visible.filter((action) => action.kind === "create" || action.kind === "update");
  const blocked = visible.filter((action) =>
    (action.kind === "blocked" || action.kind === "conflict"));
  const missing = visible.filter((action) => action.kind === "missing_once");
  const unpublish = visible.filter((action) => action.kind === "unpublish");
  const summary = visible.find((action) => action.review)?.review ?? null;
  const groups = [
    ["Eligible additions and changes", [...actionable]],
    ["Blocked", blocked],
    ["Check availability", missing],
    ["Removal suggestions — review separately", unpublish],
  ] as const;
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-text-primary">Latest review</h2>
      <p className="text-sm text-text-secondary">
        Status: <span className={STOCK_STATUS_BADGE + " " + stockStatusColour(input.status)}>{stockSyncStatus(input.status)}</span>. {actionable.length} actionable, {blocked.length} blocked.
        Approving queues processing. It does not publish listings immediately.
      </p>
      {summary && Number.isFinite(Date.parse(summary.capturedAt)) ? (
        <div className="rounded-md border border-border bg-surface-secondary px-4 py-3 text-sm text-text-secondary">
          <p>Saved scan captured {new Date(summary.capturedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}.</p>
          {summary.coverageWarning ? <p role="status">{summary.coverageWarning}</p> : null}
          {summary.capacityWarning ? <p role="status">{summary.capacityWarning}</p> : null}
        </div>
      ) : null}
      {input.failureReason ? (
        <ReportableError as="p" className="text-sm text-text-error" role="alert">
          Check incomplete: {stockSyncReason(input.failureReason)} Missing vehicles have not been counted.
        </ReportableError>
      ) : null}
      <fieldset disabled={busy} className="min-w-0 space-y-4">
      {groups.map(([title, actions]) => (
        <div key={title}>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">{title}</h3>
          {actions.length === 0 ? (
            <p className="text-sm text-text-tertiary">None</p>
          ) : (
            <ul className="space-y-2">
              {actions.map((action, index) => (
                <Row
                  key={`${action.kind}-${action.sourceIdentityKey ?? "none"}-${index}`}
                  action={action}
                  selected={selection.indexes.includes(input.actions.indexOf(action))}
                  onSelect={checked => { const index = input.actions.indexOf(action); selection.setIndexes(checked ? [...selection.indexes.filter(value => value !== index), index] : selection.indexes.filter(value => value !== index)); }}
                  reportId={input.reportId}
                  fingerprint={input.fingerprint}
                  allowEdit={input.status === "PENDING_REVIEW"}
                />
              ))}
            </ul>
          )}
        </div>
      ))}
      </fieldset>
      {Boolean(input.pendingActions?.some(isSelectableStockAction)) && <div className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="font-semibold text-text-primary">Still awaiting your review</h3>
        <p className="text-sm text-text-secondary">These items were not included in the approval. They become selectable again when processing finishes successfully. If processing fails, run a fresh stock check to recover an up-to-date review.</p>
        <ul className="space-y-2">{input.pendingActions!.filter(isSelectableStockAction).map((action, index) => <Row key={index} action={action} reportId={input.reportId} fingerprint={input.fingerprint} selected={false} onSelect={() => undefined} allowEdit={false} />)}</ul>
      </div>}
      {input.status === "PENDING_REVIEW" && <StockReviewSelectionControls reportId={input.reportId} fingerprint={input.fingerprint} actions={input.actions} selection={selection} onPendingChange={setBusy} />}
    </section>
  );
}
