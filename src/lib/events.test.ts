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
