import type { VehicleCheckResult } from "@/lib/services/vehicle-check-types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unavailable";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

export function openVehicleCheckPrintWindow(result: VehicleCheckResult) {
  const printWindow = window.open("", "_blank", "width=1040,height=1200");
  if (!printWindow) return;

  const vehicleRows = [
    ["Registration", result.displayRegistration],
    ["Make", result.vehicle?.make ?? "Unavailable"],
    ["Model", result.vehicle?.model ?? "Unavailable"],
    ["Colour", result.vehicle?.colour ?? "Unavailable"],
    ["Fuel type", result.vehicle?.fuelType ?? "Unavailable"],
    ["Tax status", result.vehicle?.taxStatus ?? "Unavailable"],
    ["Tax due", formatDate(result.vehicle?.taxDueDate)],
    ["MOT status", result.vehicle?.motStatus ?? "Unavailable"],
    ["MOT due", formatDate(result.vehicle?.motExpiryDate)],
  ];

  const motRows = result.motHistory?.motTests
    .slice(0, 12)
    .map(
      (test) => `
        <tr>
          <td>${escapeHtml(formatDate(test.completedDate))}</td>
          <td>${escapeHtml(test.testResult)}</td>
          <td>${escapeHtml(
            test.odometerValue !== null && test.odometerValue !== undefined
              ? `${test.odometerValue.toLocaleString()} ${test.odometerUnit ?? ""}`.trim()
              : "Unavailable"
          )}</td>
          <td>${escapeHtml(formatDate(test.expiryDate))}</td>
        </tr>
      `
    )
    .join("");

  const auctionRows = result.auctionHistory?.entries
    .slice(0, 10)
    .map(
      (entry) => `
        <tr>
          <td>${escapeHtml(entry.saleTitle)}</td>
          <td>${escapeHtml(entry.lotNumber ?? "N/A")}</td>
          <td>${escapeHtml(formatDate(entry.saleDate))}</td>
          <td>${escapeHtml(formatPrice(entry.hammerPrice))}</td>
        </tr>
      `
    )
    .join("");

  printWindow.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(result.displayRegistration)} vehicle check</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        color: #111827;
        background: #ffffff;
      }
      .page {
        max-width: 920px;
        margin: 0 auto;
        padding: 32px;
      }
      .header {
        border-bottom: 2px solid #e5e7eb;
        padding-bottom: 20px;
        margin-bottom: 24px;
      }
      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #6b7280;
      }
      h1 {
        margin: 10px 0 6px;
        font-size: 34px;
      }
      .meta {
        color: #4b5563;
        font-size: 14px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin-bottom: 24px;
      }
      .card {
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        padding: 18px;
      }
      h2 {
        margin: 0 0 14px;
        font-size: 18px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 10px 8px;
        border-bottom: 1px solid #f3f4f6;
        text-align: left;
        font-size: 14px;
        vertical-align: top;
      }
      th {
        color: #374151;
        width: 34%;
      }
      .full {
        margin-bottom: 24px;
      }
      .warning {
        background: #fff7ed;
        border-color: #fdba74;
      }
      @media print {
        .page {
          padding: 16px;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="header">
        <div class="eyebrow">itrader.im vehicle check dossier</div>
        <h1>${escapeHtml(result.displayRegistration)}</h1>
        <div class="meta">
          Checked ${escapeHtml(formatDate(result.checkedAt))} · ${
            result.isManx ? "Isle of Man lookup" : "UK lookup"
          }
        </div>
      </header>

      <section class="card full">
        <h2>Vehicle snapshot</h2>
        <table>
          <tbody>
            ${vehicleRows
              .map(
                ([label, value]) => `
                  <tr>
                    <th>${escapeHtml(label)}</th>
                    <td>${escapeHtml(value)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </section>

      ${
        result.warnings.length > 0
          ? `<section class="card full warning">
              <h2>Warnings</h2>
              <ul>
                ${result.warnings
                  .map((warning) => `<li>${escapeHtml(warning)}</li>`)
                  .join("")}
              </ul>
            </section>`
          : ""
      }

      ${
        result.motHistory
          ? `<section class="card full">
              <h2>MOT history</h2>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Result</th>
                    <th>Mileage</th>
                    <th>Expiry</th>
                  </tr>
                </thead>
                <tbody>${motRows}</tbody>
              </table>
            </section>`
          : ""
      }

      ${
        result.auctionHistory
          ? `<section class="card full">
              <h2>Auction history</h2>
              <table>
                <thead>
                  <tr>
                    <th>Sale</th>
                    <th>Lot</th>
                    <th>Date</th>
                    <th>Hammer</th>
                  </tr>
                </thead>
                <tbody>${auctionRows}</tbody>
              </table>
            </section>`
          : ""
      }
    </main>
  </body>
</html>`);

  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => {
    printWindow.print();
  }, 250);
}
