import { hasOpeningHours, parseOpeningHours, WEEKDAYS } from "@/lib/dealers/opening-hours";

export function DealerOpeningHours({ enabled, hours }: { enabled: boolean; hours: unknown }) {
  const parsed = parseOpeningHours(hours);
  if (!enabled || !parsed || !hasOpeningHours(parsed)) return null;
  return (
    <section aria-labelledby="opening-hours-heading" className="mb-6 rounded-lg border border-border bg-surface p-5">
      <h2 id="opening-hours-heading" className="mb-3 font-semibold">Opening hours</h2>
      <dl className="max-w-lg space-y-2 text-sm">
        {parsed.days.map((day, index) => (
          <div key={WEEKDAYS[index]} className="flex justify-between gap-4">
            <dt>{WEEKDAYS[index]}</dt>
            <dd className="text-right text-text-secondary">{day.status === "closed" ? "Closed" : day.status === "appointment" ? "By appointment" : day.status === "24hours" ? "Open 24 hours" : day.periods.map(period => `${period.opens}–${period.closes}`).join(", ")}</dd>
          </div>
        ))}
      </dl>
      {parsed.note && <p className="mt-3 text-sm text-text-secondary">{parsed.note}</p>}
      <p className="mt-3 text-xs text-text-tertiary">Local Isle of Man time. Bank holiday hours may vary.</p>
    </section>
  );
}
