import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { archiveRoot } from "../archive/paths";
import type { DealerInspectEvidence } from "./evidence";

export async function collectLatestDealerCounts(root = archiveRoot()) {
  const runsDir = join(root, "runs");
  const runIds = (await readdir(runsDir)).sort();
  const latest = new Map<string, { dealerKey: string; uniqueVehicles: number; importable: number }>();
  for (const runId of runIds) {
    const entries = await readdir(join(runsDir, runId)).catch(() => []);
    for (const dealerKey of entries) {
      if (dealerKey.endsWith(".json")) continue;
      try {
        const manifest = JSON.parse(
          await readFile(join(runsDir, runId, dealerKey, "manifest.json"), "utf8"),
        ) as { uniqueVehicles?: number; importable?: number };
        latest.set(dealerKey, {
          dealerKey,
          uniqueVehicles: manifest.uniqueVehicles ?? 0,
          importable: manifest.importable ?? 0,
        });
      } catch {
        // skip incomplete dealer folders
      }
    }
  }
  return [...latest.values()];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badge(conclusion: string) {
  if (/public_list|deeper_list/.test(conclusion)) return "ok";
  if (/blocked|facebook|no-url|no_public_site/.test(conclusion)) return "warn";
  if (/no_public_list|navigation_failed/.test(conclusion)) return "zero";
  return "neutral";
}

export async function writeInspectReport(input: {
  inspectRunId: string;
  archiveRunId: string;
  inspectDir: string;
  results: DealerInspectEvidence[];
  afterAdapter?: Array<{ dealerKey: string; uniqueVehicles: number; importable: number }>;
}) {
  const archiveManifest = JSON.parse(
    await readFile(join(archiveRoot(), "runs", input.archiveRunId, "manifest.json"), "utf8"),
  ) as {
    results: Array<{
      dealerKey: string;
      displayName: string;
      connectorKey: string;
      uniqueVehicles: number;
      importable: number;
      canArchive: boolean;
      website: string | null;
      stockUrls: string[];
      warnings?: string[];
    }>;
  };

  const inspectByKey = new Map(input.results.map((item) => [item.dealerKey, item]));
  const afterByKey = new Map((input.afterAdapter ?? []).map((item) => [item.dealerKey, item]));

  const rows = archiveManifest.results.map((row) => {
    const inspect = inspectByKey.get(row.dealerKey);
    const after = afterByKey.get(row.dealerKey);
    return {
      ...row,
      inspect,
      afterUnique: after?.uniqueVehicles ?? row.uniqueVehicles,
      afterImportable: after?.importable ?? row.importable,
    };
  });

  const beforeUnique = rows.reduce((sum, row) => sum + row.uniqueVehicles, 0);
  const beforeImportable = rows.reduce((sum, row) => sum + row.importable, 0);
  const afterUnique = rows.reduce((sum, row) => sum + row.afterUnique, 0);
  const afterImportable = rows.reduce((sum, row) => sum + row.afterImportable, 0);
  const manual = rows.filter((row) => row.afterUnique === 0 && inspectByKey.has(row.dealerKey));
  const partials = rows.filter((row) => row.inspect?.kind === "partial" || (row.afterUnique > 0 && row.afterImportable === 0));
  const feedRows = rows.filter((row) =>
    /facebook|no_public_site|navigation_failed|blocked_requires_feed|no_public_list/.test(row.inspect?.conclusion ?? ""),
  );

  const tableRows = rows
    .map((row) => {
      const conclusion = row.inspect?.conclusion ?? (row.uniqueVehicles > 6 ? "skipped_known_stock" : "not_inspected");
      const shots = (row.inspect?.pages ?? [])
        .filter((page) => page.screenshotRel)
        .slice(0, 2)
        .map(
          (page) =>
            `<a href="${escapeHtml(`${row.dealerKey}/${page.screenshotRel}`)}">shot</a>`,
        )
        .join(" ");
      return `<tr class="${badge(conclusion)}">
        <td>${escapeHtml(row.displayName)}</td>
        <td><code>${escapeHtml(row.dealerKey)}</code></td>
        <td>${escapeHtml(row.connectorKey)}</td>
        <td>${row.uniqueVehicles}</td>
        <td>${row.importable}</td>
        <td>${row.afterUnique}</td>
        <td>${row.afterImportable}</td>
        <td>${escapeHtml(conclusion)}</td>
        <td>${shots || "-"}</td>
      </tr>`;
    })
    .join("\n");

  const manualBlocks = manual
    .map((row) => {
      const pages = row.inspect?.pages ?? [];
      const images = pages
        .filter((page) => page.screenshotRel)
        .slice(0, 2)
        .map(
          (page) =>
            `<figure><img src="${escapeHtml(`${row.dealerKey}/${page.screenshotRel}`)}" alt="${escapeHtml(row.displayName)}"><figcaption>${escapeHtml(page.url)}</figcaption></figure>`,
        )
        .join("");
      return `<article class="manual">
        <h3>${escapeHtml(row.displayName)}</h3>
        <p>Last URL: <a href="${escapeHtml(pages.at(-1)?.url ?? row.website ?? "#")}">${escapeHtml(pages.at(-1)?.url ?? row.website ?? "none")}</a></p>
        <p>Conclusion: <strong>${escapeHtml(row.inspect?.conclusion ?? "")}</strong>. Visible cards: ${row.inspect?.maxVisibleCards ?? 0}. JSON responses: ${row.inspect?.jsonPayloadCount ?? 0}.</p>
        <div class="shots">${images || "<p>No screenshot captured.</p>"}</div>
      </article>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <title>Dealer stock headed re-check</title>
  <style>
    :root { --ink:#14202b; --muted:#5b6b78; --paper:#f6f1e8; --card:#fffdf8; --line:#d7cbb8; --ok:#2f6f4e; --zero:#8a2d2d; --warn:#8a5a12; }
    body { margin:0; font:16px/1.5 "Iowan Old Style", Georgia, serif; color:var(--ink); background:var(--paper); }
    header { padding:2.5rem 8vw 1.5rem; border-bottom:1px solid var(--line); }
    h1 { font-size:2rem; margin:0 0 .4rem; letter-spacing:-.02em; }
    main { padding:1.5rem 8vw 4rem; }
    .totals { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:1rem; margin:1.5rem 0; }
    .totals div { background:var(--card); border:1px solid var(--line); padding:1rem 1.1rem; }
    .totals strong { display:block; font-size:1.6rem; }
    table { width:100%; border-collapse:collapse; background:var(--card); font-size:.92rem; }
    th, td { border-bottom:1px solid var(--line); padding:.55rem .6rem; text-align:left; vertical-align:top; }
    th { font-size:.75rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
    tr.ok td:nth-child(8) { color:var(--ok); }
    tr.zero td:nth-child(8) { color:var(--zero); }
    tr.warn td:nth-child(8) { color:var(--warn); }
    .manual { margin:1.25rem 0; padding:1rem; background:var(--card); border:1px solid var(--line); }
    .shots { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:1rem; }
    img { width:100%; border:1px solid var(--line); }
    figcaption { font-size:.8rem; color:var(--muted); word-break:break-all; }
    code { font-size:.85em; }
  </style>
</head>
<body>
  <header>
    <h1>Dealer stock headed re-check</h1>
    <p>Archive <code>${escapeHtml(input.archiveRunId)}</code> · Inspect <code>${escapeHtml(input.inspectRunId)}</code></p>
  </header>
  <main>
    <h2>Why so many zeros last time</h2>
    <p>The archive connector is not a person browsing the site. Most dealers use a static HTML pass that only accepts JSON-LD, <code>__NEXT_DATA__</code>, or conservative year/title/price cards. JavaScript stock lists, wrong first-pass domains, Facebook-only pages, and missing mileage on homepage cards all produced a 0 or non-importable result.</p>
    <div class="totals">
      <div><span>Unique before</span><strong>${beforeUnique}</strong></div>
      <div><span>Importable before</span><strong>${beforeImportable}</strong></div>
      <div><span>Unique after adapters</span><strong>${afterUnique}</strong></div>
      <div><span>Importable after adapters</span><strong>${afterImportable}</strong></div>
    </div>
    <h2>Every dealer</h2>
    <table>
      <thead><tr><th>Dealer</th><th>Key</th><th>Connector</th><th>Unique</th><th>Importable</th><th>After unique</th><th>After importable</th><th>Conclusion</th><th>Shots</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <h2>Needs your manual check</h2>
    <p>Still 0 unique after adapters. Open the screenshots and confirm whether a public list exists.</p>
    ${manualBlocks || "<p>No remaining headed-inspect zeros in the manual-check bucket.</p>"}
    <h2>Partials</h2>
    <p>Homepage or shallow cards without a complete importable record, versus any deeper list found in headed inspect.</p>
    <ul>
      ${
        partials
          .map(
            (row) =>
              `<li><strong>${escapeHtml(row.displayName)}</strong> - archive ${row.uniqueVehicles}/${row.importable}, after ${row.afterUnique}/${row.afterImportable}, visible cards ${row.inspect?.maxVisibleCards ?? "-"}. Deeper URL: ${escapeHtml(row.inspect?.suggestedStockUrls[0] ?? row.stockUrls[0] ?? "none")}</li>`,
          )
          .join("\n") || "<li>No partials in this run.</li>"
      }
    </ul>
    <h2>Feed / no-site / Facebook / dead DNS</h2>
    <p>Conclusions from headed evidence, not guesses.</p>
    <ul>
      ${
        feedRows
          .map(
            (row) =>
              `<li><strong>${escapeHtml(row.displayName)}</strong> - ${escapeHtml(row.inspect?.conclusion ?? "n/a")}. Last URL: ${escapeHtml(row.inspect?.pages.at(-1)?.url ?? row.website ?? "none")}. Cards ${row.inspect?.maxVisibleCards ?? 0}, JSON ${row.inspect?.jsonPayloadCount ?? 0}.</li>`,
          )
          .join("\n") || "<li>None recorded.</li>"
      }
    </ul>
  </main>
</body>
</html>
`;

  const reportPath = join(input.inspectDir, "report.html");
  await writeFile(reportPath, html);
  return reportPath;
}
