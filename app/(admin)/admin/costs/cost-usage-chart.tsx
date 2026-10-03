import { costSeriesColor, type CostUsageDayPoint } from "@/lib/costs/usage-view";
import { formatMarkedGbp } from "@/lib/costs/format";

const WIDTH = 800;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 32, left: 56 };

export interface CostChartDomain {
  min: number;
  max: number;
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
      const value = point.cumulative[key] ?? 0;
      if (value >= 0) positive += value;
      else negative += value;
    }
    max = Math.max(max, positive);
    min = Math.min(min, negative);
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

function areaPath(
  lower: number[],
  upper: number[],
  xAt: (index: number) => number,
  yAt: (value: number) => number,
): string {
  const top = upper.map(
    (value, index) =>
      `${index === 0 ? "M" : "L"} ${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`,
  );
  const bottom = [...lower]
    .reverse()
    .map(
      (value, index) =>
        `L ${xAt(lower.length - 1 - index).toFixed(1)} ${yAt(value).toFixed(1)}`,
    );
  return `${top.join(" ")} ${bottom.join(" ")} Z`;
}

export function CostUsageChart({
  points,
  seriesKeys,
}: {
  points: CostUsageDayPoint[];
  seriesKeys: string[];
}) {
  if (points.length === 0 || seriesKeys.length === 0) {
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
    const values = points.map((point) => point.cumulative[key] ?? 0);
    const positiveLower = [...positiveStack];
    const negativeUpper = [...negativeStack];
    const positiveUpper = values.map((value, index) => {
      positiveStack[index] = (positiveStack[index] ?? 0) + Math.max(0, value);
      return positiveStack[index] ?? 0;
    });
    const negativeLower = values.map((value, index) => {
      negativeStack[index] = (negativeStack[index] ?? 0) + Math.min(0, value);
      return negativeStack[index] ?? 0;
    });
    const color = costSeriesColor(key, seriesIndex);
    return [
      ...(values.some((value) => value > 0)
        ? [{
            key: `${key}:positive`,
            direction: "positive" as const,
            color,
            d: areaPath(positiveLower, positiveUpper, xAt, yAt),
          }]
        : []),
      ...(values.some((value) => value < 0)
        ? [{
            key: `${key}:negative`,
            direction: "negative" as const,
            color,
            d: areaPath(negativeLower, negativeUpper, xAt, yAt),
          }]
        : []),
    ];
  });
  const netPath = netCostValues(points, seriesKeys)
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"} ${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`,
    )
    .join(" ");

  return (
    <svg
      role="img"
      aria-labelledby="cost-chart-title cost-chart-description"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-64 w-full"
    >
      <title id="cost-chart-title">Cumulative project costs by category</title>
      <desc id="cost-chart-description">
        Charges appear above zero, credits below zero, and the line shows the net total.
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
      {points.length === 1 ? (
        <circle cx={xAt(0)} cy={yAt(netCostValues(points, seriesKeys)[0] ?? 0)} r={4} className="fill-text-primary">
          <title>{`${first?.label}: ${formatMarkedGbp(netCostValues(points, seriesKeys)[0] ?? 0)}`}</title>
        </circle>
      ) : null}
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
