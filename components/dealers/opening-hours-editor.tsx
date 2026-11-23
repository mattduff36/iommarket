"use client";

import { Button } from "@/components/ui/button";
import { WEEKDAYS, type OpeningHours } from "@/lib/dealers/opening-hours";

export function OpeningHoursEditor({ enabled, value, onEnabledChange, onChange }: {
  enabled: boolean;
  value: OpeningHours;
  onEnabledChange: (enabled: boolean) => void;
  onChange: (hours: OpeningHours) => void;
}) {
  function updateDay(index: number, day: OpeningHours["days"][number]) {
    onChange({ ...value, days: value.days.map((current, i) => i === index ? day : current) });
  }
  return (
    <fieldset className="space-y-4 border-t border-border pt-4">
      <legend className="font-semibold">Opening hours</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={event => onEnabledChange(event.target.checked)} />
        Show opening hours on my dealer profile
      </label>
      <p className="text-sm text-text-secondary">Optional for every dealer account. Check these local times before displaying them. Leave this off if your hours are not yet confirmed.</p>
      {value.days.map((day, index) => (
        <div key={WEEKDAYS[index]} className="grid gap-2 sm:grid-cols-[7rem_10rem_1fr] sm:items-start">
          <span className="pt-2 text-sm font-medium">{WEEKDAYS[index]}</span>
          <select aria-label={`${WEEKDAYS[index]} availability`} value={day.status}
            className="h-11 rounded-sm border border-border bg-surface px-2 text-sm"
            onChange={event => {
              const status = event.target.value as typeof day.status;
              updateDay(index, { status, periods: status === "open" ? [{ opens: "", closes: "" }] : [] });
            }}>
            <option value="closed">Closed</option><option value="open">Open</option><option value="appointment">By appointment</option><option value="24hours">Open 24 hours</option>
          </select>
          {day.status === "open" && <div className="space-y-2">
            {day.periods.map((period, periodIndex) => (
              <div key={periodIndex} className="flex flex-wrap items-center gap-2">
                {(["opens", "closes"] as const).map(field => (
                  <input key={field} type="time" value={period[field]}
                    aria-label={`${WEEKDAYS[index]} ${field} ${periodIndex + 1}`}
                    className="h-11 min-w-0 rounded-sm border border-border bg-surface px-2 text-sm"
                    onChange={event => updateDay(index, { ...day, periods: day.periods.map((p, i) => i === periodIndex ? { ...p, [field]: event.target.value } : p) })} />
                ))}
                {day.periods.length > 1 && <Button type="button" variant="ghost" size="sm"
                  aria-label={`Remove ${WEEKDAYS[index]} period ${periodIndex + 1}`}
                  onClick={() => updateDay(index, { ...day, periods: day.periods.filter((_, i) => i !== periodIndex) })}>Remove</Button>}
              </div>
            ))}
            {day.periods.length < 3 && <Button type="button" variant="ghost" size="sm" onClick={() => updateDay(index, { ...day, periods: [...day.periods, { opens: "", closes: "" }] })}>Add another period</Button>}
          </div>}
        </div>
      ))}
      <label className="block space-y-2 text-sm">Holiday or appointment note
        <textarea value={value.note} maxLength={240} rows={2} className="block w-full rounded-sm border border-border bg-surface p-2"
          onChange={event => onChange({ ...value, note: event.target.value })} />
      </label>
    </fieldset>
  );
}
