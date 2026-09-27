import { costSeriesColor, type CostUsageDayPoint } from "@/lib/costs/usage-view";
import { formatMarkedGbp } from "@/lib/costs/format";

const WIDTH = 800;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 32, left: 56 };

function stackedPaths(points: CostUsageDayPoint[], seriesKeys: string[]) {
  if (points.length === 0 || seriesKeys.length === 0) return [];
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const max = Math.max(
    1,
    ...points.map((point) =>
      seriesKeys.reduce((total, key) => total + (point.cumulative[key] ?? 0), 0),
    ),
  );
  const xAt = (index: number) =>
    PAD.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const yAt = (value: number) => PAD.top + innerHeight - (value / max) * innerHeight;

  return seriesKeys.map((key, seriesIndex) => {
    const lower = points.map((point) =>
      seriesKeys.slice(0, seriesIndex).reduce((total, item) => total + (point.cumulative[item] ?? 0), 0),
    );
    const upper = points.map((point, index) => lower[index] + (point.cumulative[key] ?? 0));
    const top = upper.map((value, index) => `${index === 0 ? "M" : "L"} ${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`);
    const bottom = [...lower]
      .reverse()
      .map((value, index) => `L ${xAt(points.length - 1 - index).toFixed(1)} ${yAt(value).toFixed(1)}`);
    return {
      key,
      d: `${top.join(" ")} ${bottom.join(" ")} Z`,
    };
  });
}

export function CostUsageChart({
  points,
  seriesKeys,
}: {
  points: CostUsageDayPoint[];
  seriesKeys: string[];
}) {
  if (points.length === 0) {
    return (
      <p className="px-4 py-10 text-sm text-text-secondary">
        No costs in this period to chart.
      </p>
    );
  }

  const paths = stackedPaths(points, seriesKeys);
  const first = points[0];
  const last = points[points.length - 1];
  const max = Math.max(
    1,
    ...points.map((point) =>
      seriesKeys.reduce((total, key) => total + (point.cumulative[key] ?? 0), 0),
    ),
  );
  const ticks = [0, 0.5, 1].map((fraction) => ({
    label: formatMarkedGbp(Math.round(max * fraction)),
    y: PAD.top + (HEIGHT - PAD.top - PAD.bottom) * (1 - fraction),
  }));

  return (
    <svg
      role="img"
      aria-label="Cumulative project costs by category"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-64 w-full"
    >
      {ticks.map((tick) => (
        <g key={tick.label}>
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={tick.y}
            y2={tick.y}
            className="stroke-border"
            strokeDasharray="3 4"
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
      {paths.map((path, index) => (
        <path
          key={path.key}
          d={path.d}
          fill={costSeriesColor(path.key, index)}
          fillOpacity={0.85}
        />
      ))}
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
