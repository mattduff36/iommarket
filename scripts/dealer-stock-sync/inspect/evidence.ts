import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export type InspectKind = "zero" | "partial" | "skipped";

export interface InspectPageEvidence {
  url: string;
  title: string;
  screenshotRel: string | null;
  priceLikeCards: number;
  priceSamples: string[];
  jsonUrls: string[];
  blocked: boolean;
  facebook: boolean;
  error: string | null;
}

export interface DealerInspectEvidence {
  dealerKey: string;
  displayName: string;
  connectorKey: string;
  archiveUnique: number;
  archiveImportable: number;
  kind: InspectKind;
  skipReason: string | null;
  conclusion: string;
  suggestedStockUrls: string[];
  clickedHrefs: string[];
  pages: InspectPageEvidence[];
  maxVisibleCards: number;
  jsonPayloadCount: number;
}

export function serializeInspectEvidence(evidence: DealerInspectEvidence) {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

export async function writeDealerEvidence(dir: string, evidence: DealerInspectEvidence) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "evidence.json"), serializeInspectEvidence(evidence));
  return join(dir, "evidence.json");
}

export function concludeFromPages(evidence: Pick<DealerInspectEvidence, "pages" | "kind" | "archiveUnique">) {
  if (evidence.pages.some((page) => page.blocked)) {
    return "blocked_requires_feed";
  }
  if (evidence.pages.some((page) => page.facebook) && evidence.pages.every((page) => page.priceLikeCards === 0)) {
    return "facebook_only";
  }
  const cards = Math.max(0, ...evidence.pages.map((page) => page.priceLikeCards));
  const json = evidence.pages.some((page) => page.jsonUrls.length > 0);
  if (cards >= 3 || json) {
    return evidence.kind === "partial" ? "deeper_list_found" : "public_list_visible";
  }
  if (cards > 0) return "few_cards_visible";
  if (evidence.pages.some((page) => page.error)) return "navigation_failed";
  return evidence.archiveUnique === 0 ? "no_public_list_seen" : "partial_homepage_only";
}
