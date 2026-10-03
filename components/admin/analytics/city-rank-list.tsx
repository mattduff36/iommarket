export function CityRankList({
  cities,
}: {
  cities: Array<{ city: string; country: string; count: number; mapped: boolean }>;
}) {
  if (cities.length === 0) {
    return <p className="text-sm text-text-tertiary">No city breakdown in this range.</p>;
  }
  const max = Math.max(...cities.map((city) => city.count), 1);
  return (
    <ol className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
      {cities.map((city) => (
        <li key={`${city.country}:${city.city}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-text-primary">{city.city}</span>
            <span className="shrink-0 tabular-nums text-text-secondary">{city.count.toLocaleString()}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-elevated">
            <div className="h-full rounded-full bg-neon-blue-500" style={{ width: `${Math.max(4, (city.count / max) * 100)}%` }} />
          </div>
          <p className="mt-0.5 text-xs text-text-tertiary">
            {city.country}
            {city.mapped ? "" : " · not plotted"}
          </p>
        </li>
      ))}
    </ol>
  );
}
