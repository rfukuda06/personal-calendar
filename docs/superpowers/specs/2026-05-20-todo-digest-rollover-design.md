# Todo Digest: Include Rolled-Over Todos

**Date:** 2026-05-20
**Status:** Approved (pending spec review)

## Problem

The noon-LA todo digest email (`processTodoDigest` in `src/scripts/send-reminders.ts`) only includes todos whose `dueDate` is exactly today. The day-view UI (`GET /api/todos?date=...`) shows today's todos **plus any incomplete todos from up to 90 days back that have rolled forward**.

The mismatch means a user opens the calendar at 9 a.m., sees five rolled-over todos lingering from earlier in the week, then receives a noon email listing only the one item actually dated today. The digest is supposed to nudge action on what's outstanding; today it under-reports.

The root cause is duplicated logic: the rollover rules live inline in the GET route, and the digest has its own narrower query. They drifted.

## Goals

1. The digest lists every todo the day view would show for today, minus already-completed items.
2. Rolled-over items are visually distinct from today's items, with their original date shown.
3. The API and the digest share one query implementation so this can't drift again.

## Non-goals

- Changing the GET endpoint's JSON contract (the frontend stays untouched).
- Changing the cron cadence, dedupe semantics, or `TodoDigestSend` table.
- Reworking reminder emails for events/due-dates/big-events.
- Adding a test framework (this repo has none today; verification is manual).

## Design

### File changes

- **`src/lib/todos.ts`** *(new)* — exports `resolveTodosForDay(userId, date)` and the `ROLLOVER_DAYS` constant. Owns the rollover-aware query that's currently inlined in the GET route.
- **`src/app/api/todos/route.ts`** — `GET` calls `resolveTodosForDay` instead of running the query inline. The JSON response shape is byte-identical.
- **`src/scripts/send-reminders.ts`** — `processTodoDigest` calls `resolveTodosForDay`, filters out completed items, partitions the rest into `today` and `rolledOver`, and passes both arrays to the email.
- **`src/emails/TodoDigestEmail.tsx`** — props change from `{ todos }` to `{ today, rolledOver }`; renders two sections with headings, suppresses a heading when its section is empty.

### Shared helper

```ts
// src/lib/todos.ts
export const ROLLOVER_DAYS = 90;

export type ResolvedTodo = {
  id: string;            // occurrenceId(seriesId, occ) for recurring, todo.id for singles
  seriesId: string;
  title: string;
  notes: string | null;
  dueDate: Date;         // for recurring occurrences this is the occurrence date
  completedAt: Date | null;
  rrule: string | null;
  isOccurrence: boolean;
  occurrenceDate: Date | null;
};

export async function resolveTodosForDay(
  userId: string,
  date: Date,            // midnight UTC of an LA day
): Promise<ResolvedTodo[]>;
```

Behavior is exactly what `GET /api/todos` does today:

- **Non-recurring:** `dueDate == date OR (dueDate < rolloverCutoff AND completedAt IS NULL)`, where `rolloverCutoff = min(date, today)`.
- **Recurring:** expand RRULE in `[date - 90d, date + 1d)`. For the requested day, include the occurrence regardless of completion (so the UI can render a checkbox). For earlier occurrences, include only if there's no matching `TodoCompletion` row and no cancellation `TodoException`. Apply `overrideTitle` / `overrideNotes` from exceptions where present.
- Returns a single sorted list.

The function intentionally does **not** filter out completed items on the requested day — that matches today's GET contract (the UI shows them checked off). Callers that want a strict to-do list (the digest) apply `completedAt === null` themselves.

### Digest changes

```ts
// inside processTodoDigest, after the dedupe check
const items = await resolveTodosForDay(u.id, todayUtcMidnight);

const today = items
  .filter(
    (t) =>
      t.completedAt === null &&
      t.dueDate.getTime() === todayUtcMidnight.getTime(),
  )
  .map((t) => ({ title: t.title }));

const rolledOver = items
  .filter(
    (t) =>
      t.completedAt === null &&
      t.dueDate.getTime() < todayUtcMidnight.getTime(),
  )
  .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
  .map((t) => ({
    title: t.title,
    from: DateTime.fromJSDate(t.dueDate, { zone: "utc" }).toFormat("LLL d"),
  }));

if (today.length === 0 && rolledOver.length === 0) continue;

// existing TodoDigestSend dedupe row + try/catch around sendTodoDigestEmail stays as-is
await sendTodoDigestEmail({ to: u.email, today, rolledOver });
```

The empty-skip predicate widens from "no items today" to "no items today AND no rolled-over items," so a digest still fires when the only outstanding work is rolled over.

### Email template

```tsx
export function TodoDigestEmail({
  today,
  rolledOver,
}: {
  today: { title: string }[];
  rolledOver: { title: string; from: string }[];
}) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "system-ui, sans-serif", padding: "24px" }}>
        <Container style={{ maxWidth: 480 }}>
          {today.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Today</h2>
              <ul style={{ paddingLeft: 20, marginTop: 0 }}>
                {today.map((t, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{t.title}</li>
                ))}
              </ul>
            </>
          )}
          {rolledOver.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>Rolled over</h2>
              <ul style={{ paddingLeft: 20, marginTop: 0 }}>
                {rolledOver.map((t, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {t.title}{" "}
                    <span style={{ color: "#777" }}>(from {t.from})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Container>
      </Body>
    </Html>
  );
}
```

The `from` string is formatted in the digest script (Luxon, `"LLL d"` → `"May 17"`) so the email template stays presentational and timezone-agnostic.

## Data flow

```
LA noon tick
  └─ processTodoDigest(now)
       ├─ for each notifications-enabled user, if no TodoDigestSend row yet:
       │    ├─ items = resolveTodosForDay(user.id, todayUtcMidnight)
       │    ├─ today      = items.filter(today  && !completed)
       │    ├─ rolledOver = items.filter(past   && !completed), sorted asc
       │    ├─ if both empty -> continue
       │    ├─ insert TodoDigestSend (claims the slot)
       │    └─ sendTodoDigestEmail({ to, today, rolledOver })
       └─ on send error: delete the TodoDigestSend row so next tick retries

GET /api/todos?date=YYYY-MM-DD
  └─ items = resolveTodosForDay(userId, date)
       └─ NextResponse.json(items)        // same wire shape as before
```

## Error handling

No new failure modes. `resolveTodosForDay` throws on DB errors; both callers already propagate (the digest loop catches at the boundary, the route returns 500). The dedupe row is created before the email send and deleted on failure — that logic is unchanged.

## Verification

This repo has no test framework. Verify manually:

1. **GET parity.** Snapshot `curl http://localhost:3000/api/todos?date=2026-05-20` before and after the refactor against a seeded local DB. The two JSON bodies must be byte-identical (sort key order matches Prisma's `orderBy`).
2. **Digest dry-run.** Add a temporary `if (process.argv.includes("--dry-run")) { console.log({ to, today, rolledOver }); return; }` short-circuit inside `processTodoDigest` (or wrap `sendTodoDigestEmail`). Run `npm run reminders:cron -- --dry-run` against the prod-mirror DB at a fake noon, confirm the logged arrays match what the day view shows. Remove the dry-run path before committing the final change.
3. **Live smoke.** After deploy, trigger one real noon firing for a test user with at least one rolled-over item and confirm the rendered email shows two sections with the correct date suffix.

## Out-of-scope follow-ups

- A test framework for this repo (would unblock automated coverage of `resolveTodosForDay`).
- Surfacing the digest contents in-app (e.g., a "morning summary" card).
- Localizing the `"LLL d"` date format if non-LA users are ever added.
