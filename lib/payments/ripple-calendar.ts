export function addClampedCalendarMonth(value: Date): Date {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  const day = value.getUTCDate();
  const hours = value.getUTCHours();
  const minutes = value.getUTCMinutes();
  const seconds = value.getUTCSeconds();
  const millis = value.getUTCMilliseconds();
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  return new Date(
    Date.UTC(year, month + 1, clampedDay, hours, minutes, seconds, millis)
  );
}

export function laterDate(left: Date | null | undefined, right: Date): Date {
  if (!left || left.getTime() < right.getTime()) return right;
  return left;
}
