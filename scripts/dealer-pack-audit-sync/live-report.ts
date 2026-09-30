import { createHash } from "node:crypto";
import type {
  LiveDealerCensus,
  LiveVisualDealerResult,
  LiveVisualListingResult,
  LiveVisualReport,
} from "./live-types";
import {
  LIVE_VISUAL_KIND,
  LIVE_VISUAL_VERSION,
  liveVisualReportFingerprint,
  liveVisualReportSchema,
} from "./live-types";

export function liveVisualEvidenceDir(dealerKey: string) {
  return `live-visual/${dealerKey}`;
}

export function liveVisualEvidenceFileName(input: {
  dealerKey: string;
  kind: "t0-stock" | "t1-stock" | "t1-detail";
  identityKey?: string;
}) {
  const digest = createHash("sha256")
    .update(input.dealerKey)
    .update("\0")
    .update(input.kind)
    .update("\0")
    .update(input.identityKey ?? "")
    .digest("hex")
    .slice(0, 20);
  const label = (input.identityKey ?? input.kind)
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "listing";
  const prefix = input.kind === "t1-detail" ? "t1" : input.kind;
  return `${prefix}-${label}-${digest}.png`;
}

export function liveVisualEvidenceRelPath(input: {
  dealerKey: string;
  kind: "t0-stock" | "t1-stock" | "t1-detail";
  identityKey?: string;
}) {
  return `${liveVisualEvidenceDir(input.dealerKey)}/${liveVisualEvidenceFileName(input)}`;
}

export function buildLiveVisualReport(input: {
  runId: string;
  planFingerprint: string;
  createdAt: string;
  dealers: LiveVisualDealerResult[];
}): LiveVisualReport {
  const hidePackCount = input.dealers.filter((dealer) => dealer.hidePack).length;
  const ok = input.dealers.every((dealer) =>
    !dealer.hidePack &&
    dealer.listings.length > 0 &&
    dealer.listings.every((listing) => listing.status === "pass"),
  );
  const unsigned = {
    version: LIVE_VISUAL_VERSION,
    kind: LIVE_VISUAL_KIND,
    runId: input.runId,
    planFingerprint: input.planFingerprint,
    createdAt: input.createdAt,
    ok,
    hidePackCount,
    dealers: input.dealers,
  };
  return liveVisualReportSchema.parse({
    ...unsigned,
    fingerprint: liveVisualReportFingerprint(unsigned),
  });
}

function censusLines(census: LiveDealerCensus) {
  return [
    `- T0 census: ${census.t0Accessible ? "accessible" : "inaccessible"}` +
      `, ${census.t0CardCount} visible card(s)` +
      `${census.t0PageUrl ? ` at ${census.t0PageUrl}` : ""}`,
    `- T1 census: ${census.t1AccessibleCount}/${census.t1Attempted} detail page(s) accessible` +
      `${census.t1InaccessibleCount > 0 ? `, ${census.t1InaccessibleCount} inaccessible` : ""}`,
    `- T1 list recensus: ${census.t1ListAccessible ? "accessible" : "inaccessible"}` +
      `, ${census.t1ListCardCount} visible card(s)` +
      `${census.t1ListPageUrl ? ` at ${census.t1ListPageUrl}` : ""}`,
    `- Card deltas: added ${census.cardDeltas.added.length}, removed ${census.cardDeltas.removed.length}, unchanged ${census.cardDeltas.unchanged}`,
    `- Planned listings: ${census.plannedCount}`,
    `- Matched: ${census.matchedCount}; extra visible cards: ${census.extraObservedCount}`,
    `- Census drift: ${census.drift ? "yes" : "no"}`,
    `- T0 evidence: ${census.evidencePaths.t0 ?? "none"}`,
    `- T1 evidence: ${census.evidencePaths.t1.join(", ") || "none"}`,
    `- T1 list evidence: ${census.evidencePaths.t1List ?? "none"}`,
  ];
}

function listingLines(listing: LiveVisualListingResult) {
  const observedUrl = listing.observed?.canonicalUrl ?? listing.observed?.href ?? "not observed";
  return [
    `### ${listing.planned.title}`,
    "",
    `- Status: ${listing.status}`,
    `- Identity: ${listing.identityKey}`,
    `- Hide pack: ${listing.hidePack ? "yes" : "no"}`,
    `- Planned URL: ${listing.planned.sourceUrl ?? "none"}`,
    `- Observed URL: ${observedUrl}`,
    `- Stock id: planned ${listing.planned.stockId ?? "none"} / observed ${listing.observed?.stockId ?? "none"}`,
    `- Title-price: planned ${listing.planned.pricePence}p / observed ${listing.observed?.pricePence ?? "none"}`,
    `- Hero: ${listing.heroSrc ?? "none"}`,
    `- Gallery: ${listing.gallerySrcs.length} image(s)`,
    `- Findings: ${listing.findings.join("; ") || "none"}`,
    `- Evidence stock card: ${listing.evidencePaths.stockCard ?? "none"}`,
    `- Evidence detail: ${listing.evidencePaths.detail ?? "none"}`,
    `- Evidence images: ${listing.evidencePaths.images.join(", ") || "none"}`,
    "",
  ];
}

export function renderLiveVisualReport(report: LiveVisualReport) {
  const lines = [
    "# Live-site visual audit",
    "",
    `- Run: ${report.runId}`,
    `- Created: ${report.createdAt}`,
    `- Kind: ${report.kind}`,
    `- Plan fingerprint: ${report.planFingerprint}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Hide packs: ${report.hidePackCount}`,
    "",
  ];
  for (const dealer of report.dealers) {
    lines.push(`## ${dealer.displayName} (${dealer.dealerKey})`, "");
    lines.push(`- Action: ${dealer.actionKind}`);
    lines.push(`- Hide pack: ${dealer.hidePack ? "yes" : "no"}`);
    lines.push(`- Hide reason: ${dealer.hideReason ?? "none"}`);
    lines.push(`- Evidence dir: ${dealer.evidenceDir}`);
    lines.push(...censusLines(dealer.census), "");
    if (dealer.listings.length === 0) {
      lines.push("- Listings: none", "");
      continue;
    }
    for (const listing of dealer.listings) {
      lines.push(...listingLines(listing));
    }
  }
  return `${lines.join("\n").trim()}\n`;
}
