import { formatGbpFromPence } from "@/lib/formatting/gbp";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
import { actionLabel, reviewSections, stockSyncReason, stockSyncStatus } from "@/lib/dealer-stock-sync/review";
import { ApproveStockReportButton } from "./approve-button";

function changesFor(action: PlanAction) {
  if (action.kind !== "update" && action.kind !== "conflict" && action.kind !== "create") return [];
  return action.changes;
}

function Row({ action }: { action: PlanAction }) {
  const changes = changesFor(action);
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
      {changes.map((change) => (
        <p key={change.field} className="text-text-secondary">
          {change.field === "price" ? "Price" : "Mileage"}: {change.before == null ? "Not listed" : change.field === "price" ? formatGbpFromPence(change.before) : change.before.toLocaleString("en-GB")} to {change.after == null ? "Not listed" : change.field === "price" ? formatGbpFromPence(change.after) : change.after.toLocaleString("en-GB")}
        </p>
      ))}
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
  const sections = reviewSections(input.actions);
  const groups = [
    ["New", sections.created],
    ["Changed", sections.changed],
    ["Missing once", sections.missingOnce],
    ["Proposed unpublish", sections.unpublish],
    ["Blocked", sections.blocked],
    ["Conflicts", sections.conflicts],
  ] as const;
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-text-primary">Latest review</h2>
      <p className="text-sm text-text-secondary">
        Status: {stockSyncStatus(input.status)}. {sections.unchanged} unchanged vehicles. Approving sends the changes below for processing.
      </p>
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
