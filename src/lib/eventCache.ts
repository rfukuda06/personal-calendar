// Helpers for surgically updating the TanStack Query cache after an event
// mutation, instead of broadly invalidating every `["events", from, to]`
// entry. Broad invalidation marks every prefetched neighbor week/month as
// stale, so navigating to one re-fetches from scratch. These helpers apply
// the change in-place to every cached range, so prefetched data stays valid.
//
// Only safe for the simple, common cases: a non-recurring event being
// created/edited/moved/deleted as a whole. For anything that affects RRULE
// expansion (recurring series, occurrence overrides, "this and following"
// splits), callers fall back to `qc.invalidateQueries({ queryKey: ["events"] })`
// because computing the new expansion client-side is fragile.

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { EventModel } from "@/components/calendar/EventDialog";

type EventsKey = readonly ["events", string, string];

function isEventsKey(key: QueryKey): key is EventsKey {
  return (
    Array.isArray(key) &&
    key[0] === "events" &&
    typeof key[1] === "string" &&
    typeof key[2] === "string"
  );
}

// Range keys come from Luxon (`toISO()` → "...−07:00") and event times come
// from Date (`toISOString()` → "...Z"). Those two forms don't sort the same
// way as strings, so comparisons that look correct can flip on dates that
// straddle a UTC-offset boundary (e.g., a 23:00 LA event whose UTC string
// starts with the next day). Parse both sides into instants and compare
// numerically.
function overlaps(
  eventStart: string,
  eventEnd: string,
  rangeStart: string,
  rangeEnd: string,
) {
  const es = Date.parse(eventStart);
  const ee = Date.parse(eventEnd);
  const rs = Date.parse(rangeStart);
  const re = Date.parse(rangeEnd);
  return es < re && ee > rs;
}

export function upsertEventInCaches(qc: QueryClient, event: EventModel) {
  const caches = qc.getQueriesData<EventModel[]>({ queryKey: ["events"] });
  for (const [key, data] of caches) {
    if (!isEventsKey(key) || !data) continue;
    const [, rangeStart, rangeEnd] = key;
    const without = data.filter((e) => e.id !== event.id);
    const next = overlaps(event.startUtc, event.endUtc, rangeStart, rangeEnd)
      ? [...without, event].sort(
          (a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc),
        )
      : without;
    qc.setQueryData<EventModel[]>(key, next);
  }
}

export function removeEventFromCaches(qc: QueryClient, seriesId: string) {
  const caches = qc.getQueriesData<EventModel[]>({ queryKey: ["events"] });
  for (const [key, data] of caches) {
    if (!isEventsKey(key) || !data) continue;
    qc.setQueryData<EventModel[]>(
      key,
      data.filter((e) => e.seriesId !== seriesId),
    );
  }
}
