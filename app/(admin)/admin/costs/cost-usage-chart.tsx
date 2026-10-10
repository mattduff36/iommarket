import { costSeriesColor, type CostUsageDayPoint } from "@/lib/costs/usage-view";
import { formatMarkedGbp } from "@/lib/costs/format";

const WIDTH = 800;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 32, left: 56 };

export interface CostChartDomain {
  min: number;
  max: number;
}

function finitePence(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function costChartDomain(
  points: CostUsageDayPoint[],
  seriesKeys: string[],
): CostChartDomain {
  let min = 0;
  let max = 0;

  for (const point of points) {
    let positive = 0;
    let negative = 0;
    for (const key of seriesKeys) {
      const value = point.cumulative[key];
      if (!finitePence(value)) continue;
      if (value >= 0) positive += value;
      else negative += value;
    }
    max = Math.max(max, positive);
    min = Math.min(min, negative);
    if (finitePence(point.invoicedPence)) {
      max = Math.max(max, point.invoicedPence);
      min = Math.min(min, point.invoicedPence);
    }
    if (finitePence(point.remainingToInvoicePence)) {
      max = Math.max(max, point.remainingToInvoicePence);
      min = Math.min(min, point.remainingToInvoicePence);
    }
  }

  return min === 0 && max === 0 ? { min: 0, max: 1 } : { min, max };
}

export function netCostValues(
  points: CostUsageDayPoint[],
  seriesKeys: string[],
): number[] {
  return points.map((point) =>
    seriesKeys.reduce(
      (total, key) => total + (point.cumulative[key] ?? 0),
      0,
    ),
  );
}

function chartTicks(domain: CostChartDomain): number[] {
  if (domain.min < 0 && domain.max > 0) return [domain.max, 0, domain.min];
  if (domain.min < 0) return [0, domain.min / 2, domain.min];
  return [domain.max, domain.max / 2, 0];
}

function knownRuns(values: Array<number | null>): Array<{ start: number; end: number }> {
  const runs: Array<{ start: number; end: number }> = [];
  let start = -1;
  values.forEach((value, index) => {
    if (value !== null && start < 0) start = index;
    if (value === null && start >= 0) {
      runs.push({ start, end: index - 1 });
      start = -1;
    }
  });
  if (start >= 0) runs.push({ start, end: values.length - 1 });
  return runs;
}

function isolatedDots(
  values: ReadonlyArray<number | null>,
  kind: "invoiced" | "net-total",
  points: CostUsageDayPoint[],
  xAt: (index: number) => number,
  yAt: (value: number) => number,
) {
  return values.map((value, index) => {
    if (!finitePence(value)) return null;
    const joined = (index > 0 && finitePence(values[index - 1]))
      || (index < values.length - 1 && finitePence(values[index + 1]));
    if (joined) return null;
    const label = kind === "invoiced" ? "invoiced" : "net total remaining to invoice";
    return (
      <circle
        key={`${kind}:${points[index]?.day ?? index}`}
        data-chart-dot={kind}
        cx={xAt(index)}
        cy={yAt(value)}
        r={4}
        fill={kind === "invoiced" ? "#E4E4E7" : undefined}
        className={kind === "net-total" ? "fill-text-primary" : undefined}
      >
        <title>{`${points[index]?.label}: ${label} ${formatMarkedGbp(value)}`}</title>
      </circle>
    );
  });
}

function strokePath(
  values: Array<number | null>,
  xAt: (index: number) => number,
  yAt: (value: number) => number,
): string {
  let drawing = false;
  return values.flatMap((value, index) => {
    if (!finitePence(value)) {
      drawing = false;
      return [];
    }
    const command = drawing ? "L" : "M";
    drawing = true;
    return [`${command} ${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`];
  }).join(" ");
}

function ukLongDate(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function chartDescription(
  points: CostUsageDayPoint[],
  billingApplied: boolean,
  invoicesAvailable: boolean,
): string {
  const first = points[0];
  const last = points[points.length - 1];
  const dates = first && last
    ? `${ukLongDate(first.day)} to ${ukLongDate(last.day)}. `
    : "";
  const movement = "Charges appear above zero and credits below zero. ";
  if (!billingApplied) {
    return `${dates}${movement}The line shows the net total.`;
  }
  const latestInvoice = [...points].reverse().find((point) => finitePence(point.invoicedPence));
  const latestRemaining = [...points].reverse().find((point) => finitePence(point.remainingToInvoicePence));
  const invoice = invoicesAvailable
    ? "The dashed line shows the invoiced total. "
    : "";
  const remaining = "The white line shows the net total remaining to invoice. ";
  const amounts = [
    latestInvoice && finitePence(latestInvoice.invoicedPence)
      ? `Latest invoiced ${formatMarkedGbp(latestInvoice.invoicedPence)} on ${ukLongDate(latestInvoice.day)}.`
      : "",
    latestRemaining && finitePence(latestRemaining.remainingToInvoicePence)
      ? `Latest remaining to invoice ${formatMarkedGbp(latestRemaining.remainingToInvoicePence)} on ${ukLongDate(latestRemaining.day)}.`
      : "",
  ].filter(Boolean).join(" ");
  return `${dates}${movement}${invoice}${remaining}${amounts}`.trim();
}

function areaPath(
  lower: number[],
  upper: number[],
  startIndex: number,
  xAt: (index: number) => number,
  yAt: (value: number) => number,
): string {
  const top = upper.map(
    (value, index) =>
      `${index === 0 ? "M" : "L"} ${xAt(startIndex + index).toFixed(1)} ${yAt(value).toFixed(1)}`,
  );
  const bottom = [...lower]
    .reverse()
    .map(
      (value, index) =>
        `L ${xAt(startIndex + lower.length - 1 - index).toFixed(1)} ${yAt(value).toFixed(1)}`,
    );
  return `${top.join(" ")} ${bottom.join(" ")} Z`;
}

function areaRuns(
  key: string,
  direction: "positive" | "negative",
  color: string,
  lower: Array<number | null>,
  upper: Array<number | null>,
  xAt: (index: number) => number,
  yAt: (value: number) => number,
) {
  return knownRuns(upper).map((run) => ({
    key: `${key}:${run.start}`,
    direction,
    color,
    d: areaPath(
      lower.slice(run.start, run.end + 1).map((value) => value ?? 0),
      upper.slice(run.start, run.end + 1).map((value) => value ?? 0),
      run.start,
      xAt,
      yAt,
    ),
  }));
}

export function CostUsageChart({
  points,
  seriesKeys,
  billingApplied = false,
  invoicesAvailable = false,
}: {
  points: CostUsageDayPoint[];
  seriesKeys: string[];
  billingApplied?: boolean;
  invoicesAvailable?: boolean;
}) {
  const hasCost = points.some((point) =>
    seriesKeys.some((key) => finitePence(point.cumulative[key])),
  );
  const hasInvoice = invoicesAvailable && points.some((point) => finitePence(point.invoicedPence));
  const hasRemaining = billingApplied && points.some((point) => finitePence(point.remainingToInvoicePence));
  if (points.length === 0 || (!hasCost && !hasInvoice && !hasRemaining)) {
    return (
      <p className="px-4 py-10 text-sm text-text-secondary">
        No costs in this period to chart.
      </p>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const domain = costChartDomain(points, seriesKeys);
  const span = domain.max - domain.min;
  const xAt = (index: number) =>
    PAD.left +
    (points.length === 1
      ? innerWidth / 2
      : (index / (points.length - 1)) * innerWidth);
  const yAt = (value: number) =>
    PAD.top + ((domain.max - value) / span) * innerHeight;
  const ticks = chartTicks(domain).map((value) => ({
    value,
    label: formatMarkedGbp(Math.round(value)),
    y: yAt(value),
  }));

  const positiveStack = points.map(() => 0);
  const negativeStack = points.map(() => 0);
  const areas = seriesKeys.flatMap((key, seriesIndex) => {
    const values = points.map((point) => {
      const value = point.cumulative[key];
      return finitePence(value) ? value : null;
    });
    const positiveUpper = values.map((value, index) => {
      if (value === null || value <= 0) return null;
      const lower = positiveStack[index] ?? 0;
      positiveStack[index] = lower + value;
      return positiveStack[index] ?? 0;
    });
    const positiveLower = positiveUpper.map((upper, index) => {
      const value = values[index];
      return upper === null || value === null ? null : upper - value;
    });
    const negativeLower = values.map((value, index) => {
      if (value === null || value >= 0) return null;
      const upper = negativeStack[index] ?? 0;
      negativeStack[index] = upper + value;
      return negativeStack[index] ?? 0;
    });
    const negativeUpper = negativeLower.map((lower, index) => {
      const value = values[index];
      return lower === null || value === null ? null : lower - value;
    });
    const color = costSeriesColor(key, seriesIndex);
    return [
      ...areaRuns(`${key}:positive`, "positive", color, positiveLower, positiveUpper, xAt, yAt),
      ...areaRuns(`${key}:negative`, "negative", color, negativeLower, negativeUpper, xAt, yAt),
    ];
  });
  const netValues = billingApplied
    ? points.map((point) => finitePence(point.remainingToInvoicePence) ? point.remainingToInvoicePence : null)
    : netCostValues(points, seriesKeys);
  const invoiceValues = invoicesAvailable
    ? points.map((point) => finitePence(point.invoicedPence) ? point.invoicedPence : null)
    : [];
  const netPath = strokePath(netValues, xAt, yAt);
  const invoicePath = strokePath(invoiceValues, xAt, yAt);

  return (
    <svg
      role="img"
      aria-labelledby="cost-chart-title cost-chart-description"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-64 w-full"
    >
      <title id="cost-chart-title">Cumulative project costs by category</title>
      <desc id="cost-chart-description">
        {chartDescription(points, billingApplied, invoicesAvailable)}
      </desc>
      {ticks.map((tick) => (
        <g key={tick.value}>
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={tick.y}
            y2={tick.y}
            className={tick.value === 0 ? "stroke-text-secondary" : "stroke-border"}
            strokeDasharray={tick.value === 0 ? undefined : "3 4"}
            strokeWidth={tick.value === 0 ? 1.25 : 1}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={PAD.left - 8}
            y={tick.y + 4}
            textAnchor="end"
            className="fill-text-secondary text-[11px]"
          >
            {tick.label}
          </text>
        </g>
      ))}
      {areas.map((area) => (
        <path
          key={area.key}
          d={area.d}
          fill={area.color}
          fillOpacity={area.direction === "negative" ? 0.62 : 0.85}
          data-chart-direction={area.direction}
        />
      ))}
      {invoicePath ? (
        <path
          d={invoicePath}
          fill="none"
          stroke="#E4E4E7"
          strokeDasharray="6 4"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          data-chart-line="invoiced"
        />
      ) : null}
      {netPath ? (
        <path
          d={netPath}
          fill="none"
          className="stroke-text-primary"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          data-chart-line="net-total"
        />
      ) : null}
      {isolatedDots(invoiceValues, "invoiced", points, xAt, yAt)}
      {isolatedDots(netValues, "net-total", points, xAt, yAt)}
      {first && last ? (
        <>
          <text x={PAD.left} y={HEIGHT - 8} className="fill-text-secondary text-[11px]">
            {first.label}
          </text>
          <text
            x={WIDTH - PAD.right}
            y={HEIGHT - 8}
            textAnchor="end"
            className="fill-text-secondary text-[11px]"
          >
            {last.label}
          </text>
        </>
      ) : null}
    </svg>
  );
}
