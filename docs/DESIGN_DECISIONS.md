# Design Decisions

Short decision records for the big choices. Each entry: **what** we chose, **what else** we considered, **why** this one won. Update when a decision is made or reversed.

---

## 1. Full-stack Next.js (not separate frontend/backend)

**Chose:** Next.js App Router, UI + API routes in one project.
**Alternatives:** Vite React frontend + Express backend; pure client-side app with no server.
**Why:** One codebase, one deploy, shared TypeScript types between client and server. Multi-user with auth needs a server anyway.

## 2. Google OAuth only, no passwords

**Chose:** NextAuth v5 with the Google provider as the only sign-in method.
**Alternatives:** Email + password; both.
**Why:** No password hashing, reset flows, or credential-stuffing risk to manage. A calendar app is a natural fit for a Google login. Single user flow is simpler to build and test.

## 3. Postgres + Prisma (not a lighter DB)

**Chose:** Postgres 16 via Docker Compose in dev; Prisma as the ORM.
**Alternatives:** SQLite file; raw SQL; Drizzle ORM.
**Why:** Postgres gives us real date/time types and proper indexes on the range queries ("events where `startUtc` is in this week") that dominate a calendar app. Prisma's typed client removes a whole class of typo bugs. Docker keeps setup to one command and the DB isolated.

## 4. Store UTC, display America/Los_Angeles

**Chose:** Every timestamp in the DB is UTC. All display/conversion goes through Luxon with `zone: 'America/Los_Angeles'`.
**Alternatives:** Store local time; hardcode UTC−8 and ignore daylight savings.
**Why:** Timezones are the single biggest source of bugs in calendar code. UTC-in-the-DB is the one approach that works under DST transitions, device changes, and possible future travel/timezone-switching.

## 5. RRULE (RFC 5545) for recurrence

**Chose:** Store recurrence as an RRULE string, expanded on read via the `rrule` library.
**Alternatives:** Custom fields like `frequency`, `interval`, `end_date`.
**Why:** RRULE already handles every case we need and many we don't (every Nth weekday of the month, BYMONTHDAY, etc.). Custom schemas start simple and end up reinventing RRULE badly. Bonus: if we ever want iCal import/export or Google Calendar sync, we're already speaking the right language.

## 6. Expand occurrences on read, never write them

**Chose:** A recurring event is **one** DB row with an RRULE. When the UI asks for events in a date range, we parse the RRULE and generate occurrences in memory.
**Alternatives:** Pre-compute every occurrence as its own row at creation time.
**Why:** "Every weekday forever" would create tens of thousands of rows. Editing the series would mean rewriting all of them. Expansion on read is O(occurrences-in-view) and edits are O(1).

## 7. Separate `EventException` and `TodoCompletion` tables

**Chose:** Edits, deletes, and completions on a *single occurrence* of a recurring series are stored as separate rows keyed by `(eventId, originalStartUtc)` or `(todoId, occurrenceDate)`.
**Alternatives:** Store overrides as JSON on the parent event.
**Why:** Per-occurrence rows are queryable (e.g., "show me all completed todos this month"), indexable, and don't lock/rewrite the parent row on every small edit.

## 8. Separate `Event`, `BigEvent`, and `Todo` entities

**Chose:** Three distinct tables.
**Alternatives:** One unified "CalendarItem" table with a `type` field.
**Why:** The three have different required fields (Events have times; BigEvents and Todos don't), different UI placements, and different completion semantics. A unified table would push all those differences into runtime `if (type === ...)` branches. The UI already forks on type — the DB might as well reflect reality.

## 9. Todo rollover as a read-time computation

**Chose:** Incomplete todos with `dueDate < today` are included in today's todo-list query. The original `dueDate` is never mutated.
**Alternatives:** A nightly job that updates stale `dueDate`s to today; store a `rolloverEnabled` flag per todo.
**Why:** Read-time is stateless and always correct — no background job to fail. Keeping `dueDate` immutable preserves the record of what the todo was originally for, which matters for any future reporting ("how often did I miss my Monday todos?").

## 10. Zod schemas shared between client and server

**Chose:** One Zod schema per entity in `src/schemas/`, imported by both the React Hook Form validator and the API route handler.
**Alternatives:** Validate only on the server; hand-write two sets of types.
**Why:** Users get immediate in-form feedback *and* the server never trusts the client. Sharing one schema means the two can't drift.

## 11. Edits to recurring items never modify past occurrences

**Chose:** When the user edits or deletes a recurring item, the only options are **This event** (one occurrence override) and **This and following** (split the series at this point, original ends, new one begins). There is no "All events" option.

**Alternatives:** Three options like Google Calendar (this / this+following / all). A single always-applies-to-the-series default.

**Why:** "All events" mutating already-past occurrences is one of the most common foot-guns in calendar UIs — it silently rewrites history. Restricting the user to two options enforces the property "an edit cannot rewrite the past" structurally. Implementation cost is one extra exception table per non-event entity (`BigEventException`, `TodoException`) and one `/split` endpoint per entity, all mirroring patterns already established in Phase 9.

## 12. Drag-and-drop and notifications deferred to v2

**Chose:** v1 uses click-to-open dialog for all create/edit. No reminders.

**Why:** Drag-and-drop needs a library and layout logic that's a feature of its own. Real notifications need email or push infrastructure. Both are additive — the core model doesn't change when we add them.
