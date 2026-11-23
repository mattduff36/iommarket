import { z } from "zod";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid 24-hour time.");
const period = z.object({ opens: time, closes: time }).strict().refine(
  value => value.opens < value.closes,
  "Closing time must be later than opening time.",
);
const day = z.object({
  status: z.enum(["open", "closed", "appointment", "24hours"]),
  periods: z.array(period).max(3),
}).strict().superRefine((value, context) => {
  if ((value.status === "open") !== (value.periods.length > 0)) {
    context.addIssue({ code: "custom", message: "Add opening and closing times for open days; remove times for closed or appointment-only days." });
  }
  for (let index = 1; index < value.periods.length; index++) {
    if (value.periods[index].opens < value.periods[index - 1].closes) {
      context.addIssue({ code: "custom", message: "Opening periods must be in order and must not overlap." });
    }
  }
});

export const openingHoursSchema = z.object({
  days: z.array(day).length(7, "Provide all seven days, Monday to Sunday."),
  note: z.string().trim().max(240),
}).strict();
export type OpeningHours = z.infer<typeof openingHoursSchema>;

export function parseOpeningHours(value: unknown): OpeningHours | null {
  const parsed = openingHoursSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function hasOpeningHours(value: OpeningHours): boolean {
  return value.days.some(day => day.status !== "closed");
}

export function emptyOpeningHours(): OpeningHours {
  return { days: WEEKDAYS.map(() => ({ status: "closed", periods: [] })), note: "" };
}
