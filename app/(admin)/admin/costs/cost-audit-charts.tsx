import { formatMarkedGbp as money } from "@/lib/costs/format";
import { buildCostAuditView } from "@/lib/costs/audit-view";
import { costSeriesColor, type CostUsageModel } from "@/lib/costs/usage-view";

export function CostAuditCharts({ model }: { model: CostUsageModel }) {
  const audit = buildCostAuditView(model);
  const largest = audit.rankedDays[0]?.total ?? 1;
  return <>
    <div className="grid gap-8 border-t border-border pt-7 lg:grid-cols-2">
      <section aria-labelledby="cost-composition-title">
        <h3 id="cost-composition-title" className="text-lg font-semibold text-text-primary">What the costs are made of</h3>
        <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row">
          <svg viewBox="0 0 200 200" role="img" aria-label="Positive net costs by category" className="h-48 w-48 shrink-0">
            <circle cx="100" cy="100" r="75" fill="none" strokeWidth="28" className="stroke-border" />
            {audit.composition.map((item, index) => {
              const share = item.amountMinor / audit.positiveTotal * 100;
              const start = audit.composition.slice(0, index).reduce((sum, prior) => sum + prior.amountMinor, 0) / audit.positiveTotal * 100;
              return <circle key={item.key} cx="100" cy="100" r="75" fill="none" strokeWidth="28"
                pathLength="100" stroke={costSeriesColor(item.key, index)} strokeDasharray={`${share} ${100 - share}`}
                strokeDashoffset={-start} transform="rotate(-90 100 100)">
                <title>{`${item.key}: ${money(item.amountMinor)}`}</title>
              </circle>;
            })}
            <text x="100" y="97" textAnchor="middle" className="fill-text-primary text-[17px] font-semibold">{money(audit.positiveTotal)}</text>
            <text x="100" y="117" textAnchor="middle" className="fill-text-secondary text-[11px]">Positive categories</text>
          </svg>
          <ul className="w-full space-y-3 text-sm">
            {audit.composition.map((item, index) => <li key={item.key} className="flex items-start justify-between gap-3">
              <span className="flex items-start gap-2 text-text-secondary"><span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: costSeriesColor(item.key, index) }} />{item.key}</span>
              <span className="shrink-0 tabular-nums text-text-primary">{Math.round(item.amountMinor / audit.positiveTotal * 100)}%</span>
            </li>)}
          </ul>
        </div>
        <p className="mt-4 text-xs leading-5 text-text-secondary">Positive category balances only. Credits and reversals remain in the net total and the source detail below.</p>
        {audit.negativeCategories.map((item) => <p key={item.key} className="mt-2 flex justify-between gap-3 text-sm text-text-secondary"><span>{item.key}</span><span className="tabular-nums">{money(item.amountMinor)}</span></p>)}
      </section>
      <section aria-labelledby="cost-ranked-title">
        <h3 id="cost-ranked-title" className="text-lg font-semibold text-text-primary">Largest cost days</h3>
        <ol className="mt-6 space-y-3">
          {audit.rankedDays.map((point) => <li key={point.day} className="grid grid-cols-[4rem_1fr_5rem] items-center gap-3 text-xs">
            <span className="text-text-secondary">{point.label}</span>
            <span className="h-6 overflow-hidden rounded-sm bg-surface-elevated"><span className="block h-full bg-neon-blue-500" style={{ width: `${point.total / largest * 100}%` }} /></span>
            <span className="text-right tabular-nums text-text-primary">{money(point.total)}</span>
          </li>)}
        </ol>
        {!audit.rankedDays.length && <p className="mt-6 text-sm text-text-secondary">No positive daily balance in this period.</p>}
        <p className="mt-5 text-xs leading-5 text-text-secondary">Net client charges by service-period start (UTC), including adjustments. These are not additional provider bills.</p>
      </section>
    </div>
    <section className="border-t border-border pt-7">
      <h3 className="text-lg font-semibold text-text-primary">Costs by charged day</h3>
      <p className="mt-1 text-sm text-text-secondary">Each day split by category, with credits below zero.</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Daily costs chart, scroll horizontally on small screens"><div className="min-w-[560px]"><DailyCostChart model={model} /></div></div>
    </section>
  </>;
}

function DailyCostChart({ model }: { model: CostUsageModel }) {
  const points = model.points;
  const positive = points.map(p => Object.values(p.daily).reduce((sum, v) => sum + Math.max(v, 0), 0));
  const negative = points.map(p => Object.values(p.daily).reduce((sum, v) => sum + Math.min(v, 0), 0));
  const max = Math.max(1, ...positive);
  const min = Math.min(0, ...negative);
  const y = (v: number) => 16 + (max - v) / (max - min) * 190;
  const step = 710 / Math.max(points.length, 1);
  if (!points.length || !model.seriesKeys.length) return <p className="py-8 text-sm text-text-secondary">No costs in this period.</p>;
  return <svg viewBox="0 0 800 245" role="img" aria-label="Daily client costs by category" className="mt-5 h-64 w-full">
    {[max, 0, ...(min < 0 ? [min] : [])].map(value => <g key={value}>
      <line x1="70" x2="780" y1={y(value)} y2={y(value)} className="stroke-border" />
      <text x="62" y={y(value) + 4} textAnchor="end" className="fill-text-secondary text-[11px]">{money(Math.round(value))}</text>
    </g>)}
    {points.map((point, i) => {
      let above = 0, below = 0;
      return <g key={point.day}>{model.seriesKeys.map((key, index) => {
        const value = point.daily[key] ?? 0;
        const start = value >= 0 ? above : below;
        if (value >= 0) above += value; else below += value;
        return <rect key={key} x={70 + i * step + step * .12} y={y(Math.max(start, start + value))}
          width={Math.max(.3, step * .76)} height={Math.abs(y(start) - y(start + value))} fill={costSeriesColor(key, index)}>
          <title>{`${point.day} · ${key}: ${money(value)}`}</title>
        </rect>;
      })}</g>;
    })}
    <text x="70" y="232" className="fill-text-secondary text-[11px]">{points[0]?.label}</text>
    <text x="780" y="232" textAnchor="end" className="fill-text-secondary text-[11px]">{points.at(-1)?.label}</text>
  </svg>;
}
