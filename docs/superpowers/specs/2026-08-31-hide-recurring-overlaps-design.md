# Hide recurring events overlapped by one-off events

## Goal

When a recurring event occurrence overlaps in time with a non-recurring
(one-off) event, hide the recurring occurrence and show the one-off. This is a
display concern only.

## Requirements (from brainstorming)

- **Overlap rule:** any time intersection hides the recurring occurrence, even a
  partial one. A one-off 9:30–9:45 hides a recurring 9:00–10:00.
- **Scope:** all calendar views (day, week, month). Purely visual — reminders,
  notifications, and stored data are unaffected.
- **Directionality:** only non-recurring events hide recurring occurrences.
  - Recurring-vs-recurring overlaps: both stay.
  - Non-recurring-vs-non-recurring overlaps: both stay (stack as today).

## Approach

Add a pure helper to `src/lib/events.ts` and apply it as the final step of
`expandEventSeries`:

```
hideRecurringOverlaps(events: EventWire[]): EventWire[]
```

- Non-recurring events are those with `isOccurrence === false`.
- Recurring occurrences are those with `isOccurrence === true`.
- Drop any recurring occurrence whose range intersects any non-recurring event,
  using half-open overlap: `a.startUtc < b.endUtc && b.startUtc < a.endUtc`.
- Keep all non-recurring events and all non-overlapping recurring occurrences.

### Why this location

`expandEventSeries` is the single pure, already-unit-tested function behind both
consumers that feed the UI:

- `GET /api/events` (client fetch), and
- `EventsHydration.tsx` (SSR prefetch).

The reminders cron does **not** call it. So filtering here covers all views with
no client flicker and leaves reminders untouched — matching the two requirements
above.

## Out of scope

- Recurring-vs-recurring overlaps.
- Non-recurring-vs-non-recurring overlaps.
- All-day "big events" (separate model, not touched).

## Testing

Add cases to `src/lib/events.test.ts`:

- A recurring occurrence partially overlapping a one-off is hidden.
- A recurring occurrence not overlapping any one-off survives.
- Two recurring occurrences overlapping each other both survive.
- A one-off overlapping another one-off: both survive.

## Trade-off (accepted)

Because it is "any overlap," a short one-off fully inside a long recurring slot
still hides the whole recurring occurrence. Accepted per the chosen overlap rule.
