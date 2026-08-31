import { test } from "node:test";
import assert from "node:assert/strict";
import { expandEventSeries } from "./events";

const D = (iso: string) => new Date(iso);

// A daily-recurring series with a "Work" category. Override one field at a time
// via the `exceptions` arg in each test.
function series(
  exceptions: Parameters<typeof expandEventSeries>[1][number]["exceptions"],
) {
  return {
    id: "evt1",
    title: "Standup",
    notes: null,
    startUtc: D("2026-06-01T16:00:00.000Z"),
    endUtc: D("2026-06-01T16:30:00.000Z"),
    categoryId: "cat-work",
    rrule: "FREQ=DAILY",
    exceptions,
    reminders: [],
  };
}

const RANGE = [D("2026-06-01T00:00:00.000Z"), D("2026-06-04T00:00:00.000Z")] as const;
const byDay = (out: ReturnType<typeof expandEventSeries>) =>
  Object.fromEntries(out.map((o) => [o.startUtc.toISOString().slice(0, 10), o]));

function exception(over: Record<string, unknown> = {}) {
  return {
    originalStartUtc: D("2026-06-02T16:00:00.000Z"),
    cancelled: false,
    overrideTitle: null,
    overrideNotes: null,
    overrideStartUtc: null,
    overrideEndUtc: null,
    overrideCategoryId: null,
    ...over,
  };
}

test("expandEventSeries: a per-occurrence category override applies to only that occurrence", () => {
  const out = expandEventSeries(
    [],
    [series([exception({ overrideCategoryId: "cat-personal" })])],
    ...RANGE,
  );
  const days = byDay(out);
  assert.equal(days["2026-06-02"].categoryId, "cat-personal"); // overridden
  assert.equal(days["2026-06-01"].categoryId, "cat-work"); // inherits series
  assert.equal(days["2026-06-03"].categoryId, "cat-work"); // inherits series
});

test("expandEventSeries: a null overrideCategoryId inherits the series category", () => {
  const out = expandEventSeries(
    [],
    [series([exception({ overrideTitle: "Renamed", overrideCategoryId: null })])],
    ...RANGE,
  );
  const jun2 = byDay(out)["2026-06-02"];
  assert.equal(jun2.title, "Renamed"); // unrelated override still applies
  assert.equal(jun2.categoryId, "cat-work"); // null category => inherit series
});

// A one-off (non-recurring) event; overlaps the Jun 2 standup by default.
function single(over: Partial<Parameters<typeof expandEventSeries>[0][number]> = {}) {
  return {
    id: "one-off-1",
    title: "Doctor",
    notes: null,
    startUtc: D("2026-06-02T16:15:00.000Z"), // inside the 16:00–16:30 standup
    endUtc: D("2026-06-02T16:45:00.000Z"),
    categoryId: null,
    reminders: [],
    ...over,
  };
}

test("expandEventSeries: a one-off event hides a recurring occurrence it overlaps", () => {
  const out = expandEventSeries([single()], [series([])], ...RANGE);
  const occurrences = out.filter((o) => o.isOccurrence);
  // The Jun 2 recurring standup is hidden by the overlapping one-off; Jun 1 & 3 survive.
  assert.deepEqual(
    occurrences.map((o) => o.startUtc.toISOString().slice(0, 10)),
    ["2026-06-01", "2026-06-03"],
  );
  // The one-off itself is still present.
  assert.equal(out.some((o) => o.title === "Doctor" && !o.isOccurrence), true);
});

test("expandEventSeries: a one-off event does not hide non-overlapping occurrences", () => {
  const out = expandEventSeries(
    [single({ startUtc: D("2026-06-02T20:00:00.000Z"), endUtc: D("2026-06-02T21:00:00.000Z") })],
    [series([])],
    ...RANGE,
  );
  // No recurring occurrence overlaps this evening one-off, so all three survive.
  const occurrences = out.filter((o) => o.isOccurrence);
  assert.equal(occurrences.length, 3);
});

test("expandEventSeries: overlapping recurring occurrences do not hide each other", () => {
  // Two daily series overlapping in time; neither is a one-off, so both stay.
  const other = { ...series([]), id: "evt2", title: "Sync" };
  const out = expandEventSeries([], [series([]), other], ...RANGE);
  assert.equal(out.filter((o) => o.title === "Standup").length, 3);
  assert.equal(out.filter((o) => o.title === "Sync").length, 3);
});

test("expandEventSeries: overlapping one-off events do not hide each other", () => {
  const a = single({ id: "a", title: "A" });
  const b = single({ id: "b", title: "B" }); // same overlapping slot as A
  const out = expandEventSeries([a, b], [], ...RANGE);
  assert.equal(out.filter((o) => !o.isOccurrence).length, 2);
});
