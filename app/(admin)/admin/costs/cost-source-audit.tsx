"use client";

import { useState } from "react";
import type { CursorAuditDto } from "@/lib/costs/dto";
import { addDecimalStrings } from "@/lib/costs/money";

const usd = (value: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(Number(value));

export function CostSourceAudit({ audit }: { audit: CursorAuditDto }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(audit.rows.length / 15));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = audit.rows.slice(currentPage * 15, (currentPage + 1) * 15);
  const cashByDay = new Map<string, string>();
  for (const row of audit.rows) cashByDay.set(row.day, addDecimalStrings([cashByDay.get(row.day) ?? '0', row.providerChargeUsd]));
  const extraDays = [...cashByDay].filter(([, value]) => Number(value) > 0).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 7);
  return <section className="mb-8 rounded-xl border border-border bg-surface p-4 sm:p-7" aria-labelledby="source-audit-title">
    <p className="mb-2 text-xs font-medium uppercase tracking-widest text-text-tertiary">Owner audit · source currency USD</p>
    <h2 id="source-audit-title" className="text-lg font-semibold text-text-primary">Usage value, extra charges and client estimate</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">Included usage has a nominal token value; it is not an extra provider bill. Reported on-demand charges are shown separately. These source amounts are in US dollars and are not added to the GBP ledger totals above.</p>
    {audit.reason && <p className="mt-4 rounded-lg border border-border bg-surface-elevated p-4 text-sm leading-6 text-text-secondary">{audit.reason}</p>}
    {!rows.length && audit.status !== 'unavailable' && <p className="mt-4 text-sm text-text-secondary">No source groups in this period.</p>}
    {rows.length > 0 && <>
      <div className="mt-6 grid gap-6 border-y border-border py-6 sm:grid-cols-3">
        {[
          ['Included usage estimate', addDecimalStrings(audit.rows.filter(row => row.funding === 'included').map(row => row.clientUsd))],
          ['On-demand client estimate', addDecimalStrings(audit.rows.filter(row => row.funding === 'on-demand').map(row => row.clientUsd))],
          ['Reported extra provider charges', addDecimalStrings(audit.rows.map(row => row.providerChargeUsd))],
        ].map(([label, value]) => <div key={label}><p className="text-2xl font-semibold tabular-nums">{usd(value)}</p><p className="mt-1 text-xs text-text-secondary">{label} · USD</p></div>)}
      </div>
      <h3 className="mt-6 font-semibold text-text-primary">Days with reported extra charges</h3>
      <ol className="mt-4 max-w-xl space-y-3">{extraDays.map(([day, value]) => <li key={day} className="grid grid-cols-[5.5rem_1fr_5rem] items-center gap-3 text-xs"><span className="text-text-secondary">{day}</span><span className="h-5 bg-surface-elevated"><span className="block h-full bg-neon-blue-500" style={{width:`${Number(value) / Number(extraDays[0][1]) * 100}%`}} /></span><span className="text-right tabular-nums">{usd(value)}</span></li>)}</ol>
      {!extraDays.length && <p className="mt-3 text-sm text-text-secondary">No additional provider charges in the verified source groups for this period.</p>}
      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">Cursor source breakdown by UTC day, model and funding. All amounts in USD.</caption>
          <thead className="bg-surface-elevated text-xs text-text-secondary"><tr>
            {['Day / model', 'Funding', 'Events', 'Nominal value', 'Extra provider charge', 'Client estimate'].map(label => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}
          </tr></thead>
          <tbody>{rows.map(row => <tr key={`${row.day}:${row.model}:${row.funding}`} className="border-t border-border even:bg-surface-elevated/40">
            <td className="px-4 py-3"><span className="block text-text-primary">{row.day}</span><span className="text-xs text-text-secondary">{row.model}</span></td>
            <td className="px-4 py-3 text-text-secondary">{row.funding === 'included' ? 'Subscription usage' : 'On-demand'}{row.sourceQuality !== 'complete' && <span className="block text-xs">{row.sourceQuality} coverage</span>}</td>
            <td className="px-4 py-3 tabular-nums">{row.eventCount}</td>
            <td className="px-4 py-3 tabular-nums">{row.nominalBasis === 'unavailable' ? 'Unavailable' : usd(row.nominalUsd)}<span className="block text-xs text-text-secondary">{row.nominalBasis.replaceAll('-', ' ')}{row.nominalMissingEvents > 0 ? ` · ${row.nominalMissingEvents} missing` : ''}</span></td>
            <td className="px-4 py-3 tabular-nums">{usd(row.providerChargeUsd)}</td>
            <td className="px-4 py-3 tabular-nums">{usd(row.clientUsd)}{row.displayDiverged && <span className="block text-xs text-text-secondary">Source display differs</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-text-secondary">
        <span>{currentPage * 15 + 1}–{Math.min((currentPage + 1) * 15, audit.rows.length)} of {audit.rows.length} source groups</span>
        <div className="flex gap-2">
          <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded border border-border px-3 py-2 disabled:opacity-40">Previous source groups</button>
          <button type="button" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)} className="rounded border border-border px-3 py-2 disabled:opacity-40">Next source groups</button>
        </div>
      </div>
    </>}
  </section>;
}
