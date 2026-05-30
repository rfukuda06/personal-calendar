/**
 * Pure timing logic for the reminder dispatcher (`src/scripts/send-reminders.ts`).
 * No DB / Prisma imports so it can be unit-tested in isolation — see
 * `reminder-window.test.ts`.
 */
import { DateTime } from "luxon";
import { TZ } from "./time";

/**
 * Polling cadence of the Render Cron Job (every 5 minutes). The window below is
 * derived from this: every reminder due since the previous tick must land
 * inside one run's window or it is silently never sent. If you change the Render
 * schedule, change this to match.
 */
export const CRON_PERIOD_MS = 5 * 60 * 1000;

/**
 * Reminders whose fire time falls in [now - WINDOW_MS, now] are sent on this
 * tick. Must be >= CRON_PERIOD_MS so nothing slips through the gap between runs;
 * the extra minute absorbs Render's per-run cold-start jitter. The ReminderSend
 * unique key dedupes the overlap, so a generous window is safe.
 */
export const WINDOW_MS = CRON_PERIOD_MS + 60 * 1000;

/**
 * A reminder older than this is treated as stale and skipped rather than sent
 * late — avoids spamming a backlog when the cron recovers from an outage, and
 * (by design) means anything due during the overnight quiet window is dropped,
 * not replayed at 6am.
 */
export const STALE_MS = 60 * 60 * 1000;

/**
 * The dispatcher does no work before this LA hour; it exits before opening a DB
 * connection so Neon stays suspended overnight (compute, not storage, is the
 * metered resource). 6 => quiet 00:00-05:59 LA.
 */
export const QUIET_UNTIL_HOUR = 6;

export type WindowDecision = "fire" | "skip" | "stale";

/** Decide whether a reminder with the given fire time should fire on this tick. */
export function inWindow(fireAt: Date, now: Date): WindowDecision {
  const delta = now.getTime() - fireAt.getTime();
  if (delta < 0) return "skip"; // future
  if (delta > STALE_MS) return "stale";
  if (delta > WINDOW_MS) return "skip"; // past but outside our window
  return "fire";
}

/**
 * True when `now` is inside the overnight quiet window (before QUIET_UNTIL_HOUR
 * in LA). DST-correct because the hour is read in LA, not UTC.
 */
export function isQuietHour(now: Date): boolean {
  const laHour = DateTime.fromJSDate(now, { zone: "utc" }).setZone(TZ).hour;
  return laHour < QUIET_UNTIL_HOUR;
}

/**
 * True when `now` falls in [12:00 LA, 12:00 LA + WINDOW_MS] — i.e. the noon todo
 * digest is due. Window-based (not minute === 0) so a delayed or skipped tick
 * under the 5-minute schedule still triggers it; TodoDigestSend dedupes the day
 * so the window overlap can't double-send.
 */
export function isDigestWindow(now: Date): boolean {
  const laNow = DateTime.fromJSDate(now, { zone: "utc" }).setZone(TZ);
  const noon = laNow.set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
  const delta = now.getTime() - noon.toMillis();
  return delta >= 0 && delta <= WINDOW_MS;
}
