import type {
  PreviewPackApplyReport,
  PreviewPackAuditPlan,
  PreviewPackVerifyReport,
} from "./types";
import type {
  ProductionApplyReport,
  ProductionAuditPlan,
  ProductionVerifyReport,
} from "./production-types";

export function renderPreviewAuditReport(input: {
  plan: PreviewPackAuditPlan;
  apply: PreviewPackApplyReport | null;
  verify: PreviewPackVerifyReport;
  publicOrigin?: string;
}) {
  const applied = new Map(
    (input.apply?.results ?? []).map((result) => [result.dealerKey, result]),
  );
  const verified = new Map(
    input.verify.results.map((result) => [result.dealerKey, result]),
  );
  const origin = (input.publicOrigin ?? "https://iommarket.com").replace(/\/$/, "");
  const lines = [
    "# Dealer preview pack audit",
    "",
    `- Run: ${input.plan.runId}`,
    `- Created: ${input.verify.createdAt}`,
    `- Target: ${input.plan.target.projectRef}`,
    `- Backup: ${input.plan.backupId}`,
    `- Plan fingerprint: ${input.plan.fingerprint}`,
    `- Result: ${input.verify.ok ? "PASS" : "FAIL"}`,
    "",
  ];

  for (const action of input.plan.actions) {
    const result = applied.get(action.dealerKey);
    const verification = verified.get(action.dealerKey);
    lines.push(`## ${action.displayName} (${action.dealerKey})`, "");
    lines.push(`- Action: ${action.kind}`);
    lines.push(`- Source snapshot: ${action.sourceRunId ?? "none"}`);
    lines.push(`- Apply: ${result?.status ?? "not applied"}`);
    lines.push(`- Verification: ${verification?.ok ? "PASS" : "FAIL"}`);
    lines.push(`- Postflight listings: ${verification?.listingCount ?? 0}`);
    lines.push(`- Postflight images: ${verification?.imageCount ?? 0}`);
    if (action.kind === "disable") {
      lines.push(`- Reasons: ${action.reasons.join("; ") || "none"}`, "");
      continue;
    }

    const evidence = new Map(
      (result?.listings ?? []).map((listing) => [listing.identityKey, listing]),
    );
    lines.push(`- Listings: ${action.listings.length}`, "");
    for (const listing of action.listings) {
      const appliedListing = evidence.get(listing.identityKey);
      lines.push(`### ${listing.listing.title}`, "");
      lines.push(`- Identity: ${listing.identityKey}`);
      lines.push(`- Source: ${listing.sourceUrl ?? "source detail URL unavailable"}`);
      lines.push(
        `- Final: ${
          appliedListing ? `${origin}/listings/${appliedListing.listingId}` : "not applied"
        }`,
      );
      lines.push(`- Image findings: ${listing.findings.join("; ") || "none"}`);
      listing.images.forEach((image, index) => {
        const final = appliedListing?.finalImages[index];
        lines.push(
          `- Image ${index + 1}: ${image.width}×${image.height} ${image.format}, ` +
            `${image.bytes} bytes, sha256 ${image.checksum}, source ${image.sourceUrl}, ` +
            `final ${final?.publicId ?? "not applied"}`,
        );
      });
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

export function renderProductionAuditReport(input: {
  plan: ProductionAuditPlan;
  apply: ProductionApplyReport;
  verify: ProductionVerifyReport;
  publicOrigin?: string;
}) {
  const origin = (input.publicOrigin ?? "https://iommarket.com").replace(/\/$/, "");
  const evidence = new Map(
    input.apply.listings.map((item) => [
      `${item.dealerKey}\0${item.identityKey}`,
      item,
    ]),
  );
  const verified = new Map(
    input.verify.accounts.map((account) => [account.dealerKey, account]),
  );
  const lines = [
    "# Production dealer account audit",
    "",
    `- Run: ${input.plan.runId}`,
    `- Created: ${input.verify.createdAt}`,
    `- Target: ${input.plan.target.projectRef}`,
    `- Backup: ${input.plan.backupId}`,
    `- Plan fingerprint: ${input.plan.fingerprint}`,
    `- Result: ${input.verify.ok ? "PASS" : "FAIL"}`,
    "",
  ];
  for (const account of input.plan.accounts) {
    const verification = verified.get(account.dealerKey);
    lines.push(`## ${account.displayName} (${account.dealerKey})`, "");
    lines.push(`- Source snapshot: ${account.sourceRunId}`);
    lines.push(`- Source checksum: ${account.sourceChecksum}`);
    lines.push(`- Verification: ${verification?.ok ? "PASS" : "FAIL"}`);
    lines.push(`- Live managed listings: ${verification?.liveManaged ?? 0}`);
    lines.push(`- Taken-down managed listings: ${verification?.takenDownManaged ?? 0}`);
    lines.push(`- Unmanaged listings preserved: ${verification?.unmanaged ?? 0}`);
    lines.push(`- Postflight images: ${verification?.imageCount ?? 0}`);
    lines.push(`- Actions: ${account.actions.length}`, "");
    for (const action of account.actions) {
      if (action.kind === "take_down") {
        lines.push(`### ${action.identityKey}`, "");
        lines.push("- Action: take down stale managed listing");
        lines.push(`- Final: ${origin}/listings/${action.listingId}`, "");
        continue;
      }
      const applied = evidence.get(`${account.dealerKey}\0${action.identityKey}`);
      lines.push(`### ${action.source.listing.title}`, "");
      lines.push(`- Action: ${action.kind}`);
      lines.push(`- Identity: ${action.identityKey}`);
      lines.push(`- Source: ${action.source.sourceUrl ?? "source detail URL unavailable"}`);
      lines.push(
        `- Final: ${applied ? `${origin}/listings/${applied.listingId}` : "not applied"}`,
      );
      lines.push(`- Image findings: ${action.source.findings.join("; ") || "none"}`);
      action.source.images.forEach((image, index) => {
        const final = applied?.finalImages[index];
        lines.push(
          `- Image ${index + 1}: ${image.width}×${image.height} ${image.format}, ` +
            `${image.bytes} bytes, sha256 ${image.checksum}, source ${image.sourceUrl}, ` +
            `final ${final?.publicId ?? "not applied"}`,
        );
      });
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}
