import { DateTime, Interval } from "luxon";

export const TZ = "America/Los_Angeles";

/** Today as "YYYY-MM-DD" in America/Los_Angeles. */
export function laTodayISO(): string {
  return DateTime.now().setZone(TZ).toISODate()!;
}

/** Parse "YYYY-MM-DD" as a Luxon DateTime at 00:00 in LA. Defaults to today. */
export function laDay(iso?: string): DateTime {
  const dt = iso
    ? DateTime.fromISO(iso, { zone: TZ }).startOf("day")
    : DateTime.now().setZone(TZ).startOf("day");
  if (!dt.isValid) return DateTime.now().setZone(TZ).startOf("day");
  return dt;
}

/** Week-containing-day range. Sunday 00:00 → next Sunday 00:00 in LA. */
export function weekRange(day: DateTime): { start: DateTime; end: DateTime } {
  // Luxon's weekday: 1=Monday ... 7=Sunday. Shift so Sunday is day 0.
  const startOffset = day.weekday % 7;
  const start = day.minus({ days: startOffset }).startOf("day");
  return { start, end: start.plus({ days: 7 }) };
}

/** Day range in LA. */
export function dayRange(day: DateTime): { start: DateTime; end: DateTime } {
  return { start: day.startOf("day"), end: day.plus({ days: 1 }).startOf("day") };
}

/** Month-view range: first day of the week containing the 1st → first day
 *  of the week after the month's last day. */
export function monthGridRange(day: DateTime): { start: DateTime; end: DateTime } {
  const monthStart = day.startOf("month");
  const monthEnd = day.endOf("month").startOf("day");
  const { start } = weekRange(monthStart);
  const end = weekRange(monthEnd).start.plus({ days: 7 });
  return { start, end };
}

/** All 7 days (Sun..Sat) of the week containing `day`. */
export function weekDays(day: DateTime): DateTime[] {
  const { start } = weekRange(day);
  return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
}

/** UTC JS Date from a Luxon LA DateTime. */
export function toUtc(dt: DateTime): Date {
  return dt.toUTC().toJSDate();
}

/** Convert a stored UTC Date to an LA DateTime. */
export function fromUtc(d: Date): DateTime {
  return DateTime.fromJSDate(d, { zone: "utc" }).setZone(TZ);
}

/** Position an event within a day column. Returns minutes-from-midnight
 *  for top and duration in minutes (clamped to the day boundaries). */
export function eventPositionInDay(
  startUtc: Date,
  endUtc: Date,
  day: DateTime,
): { topMin: number; durationMin: number } | null {
  const { start, end } = dayRange(day);
  const s = fromUtc(startUtc);
  const e = fromUtc(endUtc);
  const clippedStart = s < start ? start : s;
  const clippedEnd = e > end ? end : e;
  if (clippedEnd <= clippedStart) return null;
  const topMin = clippedStart.diff(start, "minutes").minutes;
  const durationMin = clippedEnd.diff(clippedStart, "minutes").minutes;
  return { topMin, durationMin };
}

/** For grouping events by day for rendering. */
export function eventOverlapsDay(
  startUtc: Date,
  endUtc: Date,
  day: DateTime,
): boolean {
  const { start, end } = dayRange(day);
  const eventInterval = Interval.fromDateTimes(fromUtc(startUtc), fromUtc(endUtc));
  const dayInterval = Interval.fromDateTimes(start, end);
  return eventInterval.overlaps(dayInterval);
}

/** Format a DateTime for display (e.g., "9:30 AM"). */
export function formatTime(dt: DateTime): string {
  return dt.toFormat("h:mm a");
}

/** "YYYY-MM-DDTHH:mm" for datetime-local inputs, in LA. */
export function toLocalInputValue(d: Date | DateTime): string {
  const dt = d instanceof Date ? fromUtc(d) : d;
  return dt.toFormat("yyyy-MM-dd'T'HH:mm");
}

/** Parse a datetime-local value ("YYYY-MM-DDTHH:mm") as LA, return UTC Date. */
export function fromLocalInputValue(value: string): Date {
  return DateTime.fromFormat(value, "yyyy-MM-dd'T'HH:mm", { zone: TZ })
    .toUTC()
    .toJSDate();
}
