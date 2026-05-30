import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { TZ } from "./time";
import {
  inWindow,
  isQuietHour,
  isDigestWindow,
  CRON_PERIOD_MS,
  WINDOW_MS,
  STALE_MS,
} from "./reminder-window";

/** UTC Date for an LA wall-clock ISO (no zone suffix), e.g. "2026-07-15T05:30". */
function laUtc(localIso: string): Date {
  const dt = DateTime.fromISO(localIso, { zone: TZ });
  assert.ok(dt.isValid, `invalid LA instant: ${localIso}`);
  return dt.toUTC().toJSDate();
}

const NOW = new Date("2026-05-29T18:00:00.000Z");
const min = (n: number) => n * 60 * 1000;

// ---- inWindow ----

test("inWindow: future fire time is skipped", () => {
  assert.equal(inWindow(new Date(NOW.getTime() + min(1)), NOW), "skip");
});

test("inWindow: fires for a reminder due right now", () => {
  assert.equal(inWindow(NOW, NOW), "fire");
});

test("inWindow: fires mid-gap of a 5-minute cron (the silent-drop regression)", () => {
  // Due 4 minutes ago: outside the old 90s window, inside the new one. With the
  // old WINDOW_MS this reminder was silently never sent.
  assert.equal(inWindow(new Date(NOW.getTime() - min(4)), NOW), "fire");
});

test("inWindow: fires exactly at the window boundary", () => {
  assert.equal(inWindow(new Date(NOW.getTime() - WINDOW_MS), NOW), "fire");
});

test("inWindow: skips just past the window boundary", () => {
  assert.equal(inWindow(new Date(NOW.getTime() - WINDOW_MS - 1000), NOW), "skip");
});

test("inWindow: marks a long-overdue reminder stale", () => {
  assert.equal(inWindow(new Date(NOW.getTime() - STALE_MS - 1000), NOW), "stale");
});

test("window covers the full cron gap so no reminder can slip through", () => {
  assert.ok(WINDOW_MS >= CRON_PERIOD_MS);
});

// ---- isQuietHour ----

test("isQuietHour: true before 6am LA", () => {
  assert.equal(isQuietHour(laUtc("2026-07-15T00:00")), true);
  assert.equal(isQuietHour(laUtc("2026-07-15T03:00")), true);
  assert.equal(isQuietHour(laUtc("2026-07-15T05:59")), true);
});

test("isQuietHour: false from 6am LA onward", () => {
  assert.equal(isQuietHour(laUtc("2026-07-15T06:00")), false);
  assert.equal(isQuietHour(laUtc("2026-07-15T12:00")), false);
  assert.equal(isQuietHour(laUtc("2026-07-15T23:00")), false);
});

test("isQuietHour: reads LA wall-clock across DST, not UTC", () => {
  const summer = laUtc("2026-07-15T05:00"); // PDT (UTC-7) => 12:00 UTC
  const winter = laUtc("2026-01-15T05:00"); // PST (UTC-8) => 13:00 UTC
  // Same LA wall-clock, different UTC hour — proves the conversion to LA.
  assert.equal(summer.getUTCHours(), 12);
  assert.equal(winter.getUTCHours(), 13);
  assert.equal(isQuietHour(summer), true);
  assert.equal(isQuietHour(winter), true);
});

// ---- isDigestWindow ----

test("isDigestWindow: true at exactly noon LA", () => {
  assert.equal(isDigestWindow(laUtc("2026-07-15T12:00")), true);
});

test("isDigestWindow: true within the window after noon", () => {
  assert.equal(isDigestWindow(laUtc("2026-07-15T12:03")), true);
});

test("isDigestWindow: true at the window boundary", () => {
  const noon = laUtc("2026-07-15T12:00");
  assert.equal(isDigestWindow(new Date(noon.getTime() + WINDOW_MS)), true);
});

test("isDigestWindow: false past the window", () => {
  assert.equal(isDigestWindow(laUtc("2026-07-15T12:07")), false);
});

test("isDigestWindow: false before noon", () => {
  assert.equal(isDigestWindow(laUtc("2026-07-15T11:59")), false);
});

test("isDigestWindow: false outside midday", () => {
  assert.equal(isDigestWindow(laUtc("2026-07-15T06:00")), false);
});

test("isDigestWindow: noon is LA-local across DST", () => {
  // Winter noon LA = 20:00 UTC; summer noon LA = 19:00 UTC. Both must trigger.
  assert.equal(isDigestWindow(laUtc("2026-01-15T12:00")), true);
  assert.equal(isDigestWindow(laUtc("2026-07-15T12:00")), true);
});
