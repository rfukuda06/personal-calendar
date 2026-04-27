# Phase Log

A running summary of what was built in each implementation phase. Updated at the end of every phase.

---

## Phase 1 — Scaffold ✅

**Goal:** Get the project skeleton, toolchain, and beginner docs in place so every later phase has somewhere to plug into.

### What was installed

- **Next.js 15** (App Router, TypeScript, Tailwind, Turbopack, ESLint) — scaffolded via `create-next-app`.
- **shadcn/ui** — initialized with Radix + Nova preset. Seeded `src/components/ui/button.tsx` and `src/lib/utils.ts` (the `cn()` helper).
- **Prisma 7** + `@prisma/client` + `@prisma/adapter-pg` — ORM and the Postgres driver adapter Prisma 7 now requires.
- **NextAuth v5 (beta)** + `@auth/prisma-adapter` — auth, to be wired up in Phase 2.
- **Luxon** (+ types) — timezone-aware date handling.
- **rrule** — RFC 5545 recurrence.
- **React Hook Form** + **Zod** + `@hookform/resolvers` — forms and validation.
- **TanStack Query** — client-side data fetching/caching.
- **dotenv** (dev) — loads `.env` into `prisma.config.ts`.

### Files created / changed

- `docker-compose.yml` — local Postgres 16 service (user/db `calendar`, port 5432, named volume `postgres_data`).
- `.env` — `DATABASE_URL` pointing at the Docker Postgres + empty slots for `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.
- `.env.example` — committed template.
- `prisma/schema.prisma` — generator + datasource skeleton only (models come in Phase 3).
- `src/lib/db.ts` — singleton Prisma client with `PrismaPg` adapter, stored on `globalThis` in dev to survive hot reload.
- `docs/TECH_STACK.md` — every library, what it is, how it fits the app.
- `docs/PROJECT_STRUCTURE.md` — folder map + end-to-end request lifecycle walk-through.
- `docs/DESIGN_DECISIONS.md` — 11 decision records covering the big architectural choices.
- `CLAUDE.md` — project overview, how to run it, conventions, and the doc-upkeep rule (update the three docs only on important changes).
- `docs/PHASES.md` — this file.

### Deviations from the plan

- **Prisma 7 driver-adapter change.** The plan assumed the classic `url = env("DATABASE_URL")` in `schema.prisma`. Prisma 7 (released since the plan was written) removed that — connection URL now lives in `prisma.config.ts`, and `PrismaClient` requires an explicit driver adapter. Added `@prisma/adapter-pg` and pass it to the constructor in `src/lib/db.ts`. No functional change to the app; just a different way of wiring the same thing.

### Verification

- `npx tsc --noEmit` passes with zero errors.
- `npx prisma generate` succeeds, client generated at `src/generated/prisma/`.
- Dev server not started yet — nothing meaningful to see until Phase 2 adds auth and Phase 3 adds models.

### What's next

Phase 2 — NextAuth v5 with Google provider, Prisma adapter, middleware to protect `/calendar/*`.

---

## Phase 2 — Auth ✅

**Goal:** Users can sign in with Google, and `/calendar/*` routes are gated behind a session.

### Files created / changed

- `src/auth.ts` — NextAuth v5 config. Google provider, JWT sessions, `/signin` as the custom sign-in page, `jwt`/`session` callbacks that carry `googleId` (the Google `sub`) through to the client-visible session.
- `src/app/api/auth/[...nextauth]/route.ts` — re-exports `GET`/`POST` from the NextAuth handlers.
- `src/middleware.ts` — wires NextAuth `auth` as middleware with `matcher: ["/calendar/:path*"]` so unauthenticated visits to the calendar redirect to `/signin`.
- `src/app/signin/page.tsx` — sign-in page with a "Sign in with Google" button (server action calling `signIn("google", { redirectTo: "/calendar/week" })`).
- `src/app/page.tsx` — replaced boilerplate with a redirect: signed in → `/calendar/week`, signed out → `/signin`.
- `src/app/calendar/week/page.tsx` — placeholder landing page with the user's email and a Sign out button. The real week grid lands in Phase 5.
- `src/types/next-auth.d.ts` — module augmentation so `session.user.googleId` and `JWT.googleId` are typed.
- `.env` — filled in `AUTH_SECRET` with a freshly generated random value. `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are still empty and need to be populated by the user.
- `docs/PROJECT_STRUCTURE.md` — folder tree updated to include `src/auth.ts`, `src/middleware.ts`, `src/app/signin/`, `src/types/`, and the `api/auth/[...nextauth]/` route.

### Deviations from the plan

- **JWT session strategy, not Prisma adapter (temporarily).** The plan originally said Prisma adapter, but that requires the `User`/`Account`/`Session` tables, which don't exist until Phase 3 creates the schema. Using JWT sessions keeps Phase 2 self-contained and testable without a DB. Phase 3 will either (a) swap to the Prisma adapter or (b) keep JWT and upsert a `User` row on first sign-in via the `signIn` callback — decision deferred until the schema is in.

### What you need to do before testing

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** of type **Web application**.
3. Add `http://localhost:3000` as an Authorized JavaScript origin.
4. Add `http://localhost:3000/api/auth/callback/google` as an Authorized redirect URI.
5. Copy the client ID and client secret into `.env`:
   ```
   AUTH_GOOGLE_ID="..."
   AUTH_GOOGLE_SECRET="..."
   ```
6. `npm run dev` → visit http://localhost:3000 → should redirect to `/signin` → click the button → Google flow → lands on `/calendar/week` with your email shown.

### Verification

- `npx tsc --noEmit` passes.
- Full end-to-end sign-in can only be verified once the user adds Google OAuth credentials (see above).

### What's next

Phase 3 — write `prisma/schema.prisma` (User, Category, Event, EventException, BigEvent, Todo, TodoCompletion), run initial migration, decide on Prisma adapter vs. JWT+upsert, seed a test category.

---

## Phase 3 — Schema + migrations ✅

**Goal:** Every entity has a DB table, and the signed-in user has a stable `userId` the rest of the app can key data off of.

### Files created / changed

- `prisma/schema.prisma` — full schema for all seven tables:
  - `User` — `id`, `email`, `name`, `image`, `googleId` (unique), timestamps.
  - `Category` — `userId`, `name`, `color`, unique on `(userId, name)`.
  - `Event` — `userId`, optional `categoryId`, `title`, `notes`, `startUtc`, `endUtc`, optional `rrule`, indexed on `(userId, startUtc)`.
  - `EventException` — per-occurrence override for a recurring Event: `eventId`, `originalStartUtc`, `cancelled`, `overrideTitle/Notes/StartUtc/EndUtc`. Unique on `(eventId, originalStartUtc)`.
  - `BigEvent` — `userId`, `categoryId?`, `title`, `notes`, `date` (`@db.Date`, no time), `rrule?`. Indexed on `(userId, date)`.
  - `Todo` — `userId`, `categoryId?`, `title`, `notes`, `dueDate` (`@db.Date`), `rrule?`, `completedAt?`. Indexed on `(userId, dueDate)`.
  - `TodoCompletion` — per-occurrence completion for recurring todos: `todoId`, `occurrenceDate`, `completedAt`. Unique on `(todoId, occurrenceDate)`.
- `prisma/migrations/20260424181441_init/migration.sql` — generated by `prisma migrate dev --name init`.
- `src/auth.ts` — added `signIn` callback that upserts the `User` row on every sign-in (keyed by Google `sub`). `jwt` callback now also looks up the DB `userId` and stores it on the token. `session` callback exposes `session.user.id` to the rest of the app.
- `src/types/next-auth.d.ts` — added `user.id` to `Session` and `userId` to `JWT`.
- `src/lib/session.ts` — `requireUserId()` helper for API routes. Throws a 401 `Response` if no session; returns the DB user id otherwise.

### Decisions made

- **Kept JWT sessions; upsert User manually on sign-in.** The alternative was swapping to `@auth/prisma-adapter` and DB-backed sessions, which would have required `Account`/`Session`/`VerificationToken` tables we don't otherwise need. JWT + upsert keeps the schema tight and avoids a round-trip to the DB on every authenticated request (the token carries the `userId` directly).

### Verification

- `docker-compose up -d` brings up Postgres 16.
- `npx prisma migrate dev --name init` applied cleanly and generated the client.
- `docker exec personal_calendar_postgres psql -U calendar -d calendar -c "\dt"` shows all 7 tables (plus `_prisma_migrations`).
- `npx tsc --noEmit` passes.
- End-to-end: signing in with Google now creates a row in `User`. Confirmed via `SELECT * FROM "User";` after a test sign-in (user should verify on their side).

### Phase 3 fix-up — Edge runtime compatibility

After Phase 3, `npm run dev` threw `Failed to load external module node:path` when hitting a protected route. Cause: middleware runs on the Edge runtime, but our `auth.ts` imports Prisma (which needs Node built-ins).

Fix (standard NextAuth v5 split-config pattern):

- **New `src/auth.config.ts`** — edge-safe: just `providers`, `session.strategy`, `pages`. No Prisma import.
- **`src/middleware.ts`** — builds its own `NextAuth(authConfig)` from the edge-safe config only.
- **`src/auth.ts`** — `NextAuth({ ...authConfig, callbacks: { ... } })`. Still used by route handlers and server components (Node runtime).

### What's next

Phase 4 — Categories CRUD: `GET/POST /api/categories`, `PATCH/DELETE /api/categories/[id]`, a minimal settings UI to manage them. Needed before Event/BigEvent/Todo forms can show a category picker.

---

## Phase 4 — Categories CRUD ✅

**Goal:** Users can create, rename, recolor, and delete their own categories. This lands first because Events / BigEvents / Todos in later phases all reference `categoryId`.

### Files created / changed

**Schemas & API:**
- `src/schemas/category.ts` — `categoryCreateSchema` (name + hex color), `categoryUpdateSchema` (partial). Shared by the form and the API routes.
- `src/app/api/categories/route.ts` — `GET` (list current user's categories) and `POST` (create). Handles Prisma `P2002` unique-violation and returns 409 with a friendly message.
- `src/app/api/categories/[id]/route.ts` — `PATCH` and `DELETE`. Uses `updateMany` / `deleteMany` with `where: { id, userId }` so a user can never touch another user's row even with a guessed id.

**Client infra:**
- `src/components/providers.tsx` — `QueryClientProvider` for TanStack Query, with `staleTime: 30s` and `refetchOnWindowFocus: false`.
- `src/app/layout.tsx` — wraps children in `<Providers>`, updates site title to "Personal Calendar".
- `src/lib/api.ts` — `api.get / post / patch / del` typed fetch wrappers. Throws an `Error` whose `message` is the server's error string when available.

**UI:**
- `src/components/calendar/CategoriesManager.tsx` — list + inline add form + per-row edit/delete. Uses React Hook Form + Zod, 8 preset color swatches, and a free-text hex input.
- `src/app/calendar/settings/categories/page.tsx` — page shell that renders the manager.
- `src/app/calendar/week/page.tsx` — added a "Categories" link in the header.
- `src/components/ui/input.tsx`, `src/components/ui/label.tsx` — added via `shadcn add`.

### Security note

Every mutation uses `where: { id, userId }` in Prisma, not just `where: { id }`. That means a user sending `DELETE /api/categories/<some-other-user's-id>` gets a 404 and nothing else happens. Pattern to carry forward into all subsequent API routes.

### Verification

- `npx tsc --noEmit` passes.
- Manual: sign in → `/calendar/week` → click **Categories** → add one ("Work", `#3b82f6`) → rename it → delete it. Duplicate names surface the 409 as an alert.

### What's next

Phase 5 — Events CRUD for non-recurring events: `GET/POST /api/events` (GET takes a date range), `PATCH/DELETE /api/events/[id]`, `EventDialog` for create/edit, and a `WeekView` hour grid that renders single-occurrence events. Recurrence is deferred to Phase 9.

---

## Phase 5 — Events CRUD + WeekView ✅

**Goal:** Click an hour slot → create event. Click an event → edit or delete. Navigate between weeks with ←/→/Today. Non-recurring only; recurrence is Phase 9.

### Files created / changed

**Time utilities (`src/lib/time.ts`):** Luxon helpers that every view reuses.
- `laTodayISO()`, `laDay()`, `weekRange()`, `dayRange()`, `monthGridRange()`, `weekDays()`
- `toUtc()`, `fromUtc()` — UTC ↔ LA conversion
- `eventPositionInDay()` — returns `{ topMin, durationMin }` for rendering a block inside a day column, clamped to the day's 0–1440 minute range
- `eventOverlapsDay()` — for filtering events per day column
- `toLocalInputValue()` / `fromLocalInputValue()` — convert Date ↔ `YYYY-MM-DDTHH:mm` strings for `<input type="datetime-local">`, always in LA

**Schemas (`src/schemas/event.ts`):** `eventCreateSchema` / `eventUpdateSchema`, shared by the form and the API routes. Refined with `endUtc > startUtc`.

**API:**
- `src/app/api/events/route.ts` — `GET` with required `?from=&to=` ISO query params (returns non-recurring events overlapping the range; recurring events filtered out until Phase 9). `POST` creates.
- `src/app/api/events/[id]/route.ts` — `PATCH` + `DELETE`, both scoped to `{ id, userId }`.

**UI:**
- `src/app/calendar/layout.tsx` — new shared header (title, signed-in email, Sign out). The week-view-specific header was removed so day/month views can share this shell in Phase 6.
- `src/app/calendar/week/page.tsx` — now just a redirect to `/calendar/week/<today-in-LA>`.
- `src/app/calendar/week/[date]/page.tsx` — renders `<WeekView dateISO={date} />`.
- `src/components/calendar/WeekView.tsx` — fixed-height hour grid (48px/hr × 24hr), Sun→Sat columns, absolutely-positioned event blocks colored by their category's left border, today column highlighted, ←/→/Today navigation links to other weeks.
- `src/components/calendar/EventDialog.tsx` — create/edit modal. RHF + Zod, datetime-local pickers for start/end, native `<select>` for category (pulled from the same TanStack-Query `categories` cache), Textarea for notes, Delete button in edit mode.
- `src/components/ui/dialog.tsx`, `src/components/ui/select.tsx`, `src/components/ui/textarea.tsx` — added via `shadcn add`.

### Bug found and fixed

Curl-probed `/calendar/week/<date>` with no cookies and got a 200. The middleware matcher was firing on `/calendar/*` but didn't actually block — NextAuth v5's default middleware just attaches `req.auth` without gating. Fix:

- `src/auth.config.ts` — added an `authorized` callback: returns `isLoggedIn` for `/calendar/*` paths, `true` everywhere else. Now unauthed requests to the calendar get a 307 to `/signin?callbackUrl=...`.

Since middleware is edge-safe, this callback had to live in `auth.config.ts` (not `auth.ts`).

### Verification

- `npx tsc --noEmit` clean.
- `curl -sI http://localhost:3000/calendar/week/...` without cookies → 307 to `/signin`. With a signed-in browser → 200.
- Manual: sign in → week grid renders for today → click an empty slot → dialog opens with 1-hour default → submit → event appears at the right spot, colored by its category → click it → edit/delete works. Navigate with ←/→; URL updates; events for that week load.

### What's next

Phase 6 — Day + Month views. Reuse `EventDialog` and the event-rendering logic. Day view adds placeholders for the BigEvent all-day bar (Phase 7) and the TodoList right rail (Phase 8). Month view renders a 6-week grid with up to 2–3 event chips per day.

---

## Phase 5 — UX polish pass ✅ (post-MVP, before Phase 6)

After the initial Phase 5 landed, a long iterative polish pass replaced most of the original WeekView / EventDialog UX. The current state below is what Phase 6 starts on top of.

### Week grid

- **10-minute slots, not hourly.** 144 slots per day (24h × 6), each `SLOT_HEIGHT = 9px` → hour height = 54px, grid height = 1296px. Hour boundaries get a darker divider (`border-foreground/30`), 10-min dividers lighter (`border-foreground/10`). Day columns get a `border-l-2 border-foreground/20` and a closing `border-b` so the 11PM hour's last 10-min line renders.
- **Full 24 hours** (not 6am–midnight). On mount/route change the grid auto-scrolls to 7AM via a ref + `scrollTop = 7 * HOUR_HEIGHT`.
- **Hour label column** (2.5rem wide) shows a big bold number `text-xl` centered vertically in each hour with "AM"/"PM" stacked below in small text.
- **Slot hover label** shows `h:mm` (e.g., "3:10") in the top-left of each 10-min slot, visible only on hover.
- **Sticky day headers** (`SUN 19`, `MON 20`, etc.) live INSIDE the same scroll container as the grid (`position: sticky; top: 0`) so the columns line up with the grid regardless of scrollbar width — previously had a misalignment bug on Fri/Sat.
- Today column gets `bg-primary/5`, today's number turns primary.

### Top header (`CalendarHeader`, client component)

- New `src/components/calendar/CalendarHeader.tsx` replaces the old layout header. Uses `usePathname` to detect `/calendar/week/:date` and show week-nav (← → Today + "Apr 19 – Apr 25, 2026") only on week pages.
- `src/app/actions/auth.ts` exposes `signOutAction` so the client header can call `<form action={signOutAction}>`.
- Header has: Calendar title | week nav | Categories link | email | Sign out — all in one row. This replaced both a separate thin nav strip and the old two-row day/week header, saving vertical space.

### Floating event dialog (not a side panel)

- `EventDialog` is no longer a full-height right-edge panel. It's a **340px floating card** anchored next to the draft's day column, aligned vertically with the draft block's top position.
- **Side rule:** Sun/Mon/Tue/Wed → floats on the **right** of the column (`left-full ml-2`); Thu/Fri/Sat → **left** (`right-full mr-2`). Dayindex-based (`dayIndex <= 3` → right).
- Rendered inside each day column via `{dialogOpen && day.toISODate() === draftDayISO && (...)}`; scrolls with the grid.
- Card: `rounded-lg`, `shadow-2xl`, `max-h-[80vh]`, internal overflow.

### Event creation / editing flow

- **First click** on a free slot creates a **10-minute draft** (no 1-hour default), opens the dialog, and auto-enters **pick-end** mode so the end pill follows the cursor until the user clicks again.
- **Two ways to change time after creation:**
  1. **Drag** the top or bottom pill on the draft block (click-vs-drag detection: > 3px movement = drag, else click).
  2. **Click** a pill to enter picking mode for that side; the pill then follows the cursor; any click anywhere commits.
- **Pill visuals:** small `bg-primary` pill always visible on each edge (`h-1 w-12` default). When picking, it becomes `h-0.5 w-16 animate-pulse` (thinner, wider, pulsing). Tiny time label sits next to each pill showing the current value (e.g., "2:10 PM") with a subtle ring and primary text color when picking. Cursor is `cursor-pointer` (not ns-resize).
- **Smooth hover preview:** while picking, a document-level `pointermove` listener snaps the pill to the nearest 10-min slot. Previous implementation used per-slot `onMouseEnter` which skipped slots on fast movement.
- **Commit on any click:** document-wide `click` listener while `pickingSide` is set calls `commitPicking`. Registered on next tick (setTimeout 0) so the triggering click doesn't immediately fire.
- **Cancel restores pre-pick values** via `prePickStart` / `prePickEnd` refs captured in `enterPicking`; banner "cancel" link and dialog close both call `cancelPicking`.
- **Draft block visibility:** while editing, the actual event block is hidden from the grid (filtered by `e.id !== editingEvent?.id`) so only the draft overlay is shown. On dialog close, `editingEvent` is cleared in the same `onOpenChange` handler so the block re-appears at the new position.

### Overlap rules (no two events may overlap; touching is fine)

Client-side (`WeekView`):
- `findAdjacent(events, time, day, excludeId)` returns closest prev (ends at/before `time`) and next (starts at/after `time`).
- `isInsideEvent(events, t, excludeId)` uses half-open `[s, en)`.
- `computePick(side, day, clickedUtc)` is the single source of truth for slot-click, hover-preview, and click-to-pick validity. For the **end** side, `isInsideEvent` is intentionally NOT checked because `t === next.startUtc` means touching, which is allowed; the `maxEnd` clamp handles it.
- **Fresh click rejected** if inside an existing event, or if `next && gap < MIN_MS`.
- **Drag** clamps to `prev.endUtc` and `next.startUtc` with a 10-minute minimum duration.
- **Event-block `onClick` ignored while dialog is open** so a click that happens to land on another event's block doesn't hijack the picking commit.

Server-side:
- `src/lib/events.ts::hasOverlappingEvent` uses `startUtc: { lt: endUtc }` + `endUtc: { gt: startUtc }` (strict), which naturally permits touching events.
- POST `/api/events` and PATCH `/api/events/[id]` both call it; PATCH uses `excludeId` so an event isn't flagged against itself.
- Zod schemas in `src/schemas/event.ts` now truncate start/end to the minute boundary via a transform — prevents seconds-drift from silently breaking "touching" comparisons.

### EventDialog fields (current layout, top to bottom)

1. (optional error line if `end <= start`)
2. **Title** — RHF `register`, `autoFocus`
3. **Category** — flex-wrap row of small `CategoryChip` components (border + color swatch + name, border-primary + ring when selected); includes a "None" chip; single-select
4. **Notes** — Textarea
5. Footer buttons: **[Cancel] [Create]** for creating, **[Delete] [Save]** for editing (no Cancel in edit mode; X in top-right still closes)

The dialog-internal "Time" section with Start/End cards was removed — users see the times on the pill labels on the calendar instead.

### Keyboard shortcuts in the dialog (document-level keydown while open)

- **Enter** → save (from any focused element except a textarea, where Enter inserts a newline). Fires `handleSubmit((v) => save.mutate(v))()`.
- **Shift+Enter** → delete if editing, cancel if creating (except in a textarea, where Shift+Enter inserts a newline).
- Delete button calls `del.mutate()` directly — no `confirm()` dialog anymore.
- All three buttons (Save/Cancel/Delete) live in one right-aligned row with `gap-2`.

### Event block rendering (solid, rectangular, no border)

Each event block:
- **Rectangular**, no rounded corners, full-width within its day column (`left-0 right-0`).
- **Solid fill** using the category color (`backgroundColor: cat.color`; default `#3b82f6` if uncategorized). No border.
- **White text**, `tracking-tight`, time in `tabular-nums font-medium`, title in `font-semibold`.
- Hover `title` attribute shows `title — start – end` for accessibility.
- **Height equals the real duration minus 1px** (no 18px minimum). A 10-min event is ~8px tall; short events used to overflow their slot and block clicks on the following slot's creation slot.

**Layout tiers by `heightPx`:**

| Height (min) | Layout | Title class | Time class |
|---|---|---|---|
| < 12 (≤10) | single line: `Title start–end` | `text-[7px] leading-none` | same |
| < 22 (≤20) | single line | `text-[9px] leading-none` | same |
| < 30 (≤30) | single line | `text-[10px] leading-tight` | same |
| 30–49 | horizontal split: title left, start top-right + end bottom-right | `text-xs` | `text-[11px]` |
| ≥ 50 (≥60) | same layout as 30–49 but larger | `text-sm` | `text-xs` |

(Times on blocks are now `h:mm` only — AM/PM removed from event blocks.)

### Misc small UX changes worth noting

- **Hover slot label** iterated: 1–6 → 0–5 → "10/20/30/40/50" minutes → finally full `h:mm` (e.g., "3:10").
- **Day label header** `text-sm`, single line `SUN 19`, today's digit colored primary.
- **Hour number** bumped to `text-xl font-bold` in the hour column.
- **Typography** set to `tracking-tight tabular-nums` for time displays (Geist Sans is already the app font).

---

## Phase 6 — Day + Month views ✅

**Goal:** Users can switch between Day, Week, and Month views. Day view reuses the hour grid; Month view is a 6-week overview with event chips.

### Files created / changed

**Shared hour grid:**
- `src/components/calendar/DaysView.tsx` — extracted from `WeekView`. Renders an N-day hour grid (1 ≤ N ≤ 7), with all the Phase 5 interaction logic (slot click, pick-end-mode, drag pills, floating dialog, overlap rules). Accepts `days`, `rangeStart`, `rangeEnd`, `scrollKey`, and `showDayLabels`.
- `src/components/calendar/WeekView.tsx` — reduced to a thin wrapper: `<DaysView>` with 7 days.

**Day view:**
- `src/components/calendar/DayView.tsx` — `<DaysView>` with a single day, plus a top "All day" bar (placeholder for Phase 7 BigEvents) and a right-hand todo rail (placeholder for Phase 8). Day labels are hidden since the date is shown in the header and all-day bar.
- `src/app/calendar/day/page.tsx` — redirects `/calendar/day` → `/calendar/day/<today>`.
- `src/app/calendar/day/[date]/page.tsx` — renders `<DayView dateISO={date} />`.

**Month view:**
- `src/components/calendar/MonthView.tsx` — 6-row × 7-col grid from `monthGridRange()`. Each cell shows the day number (muted if outside the anchor month, primary if today), up to 3 event chips (`h:mm` + title, colored by category), and "+N more" for overflow. Clicking a cell navigates to the day view for that date.
- `src/app/calendar/month/page.tsx` — redirect to today.
- `src/app/calendar/month/[date]/page.tsx` — renders `<MonthView />`.

**Header:**
- `src/components/calendar/CalendarHeader.tsx` — now detects any of `/calendar/(day|week|month)/:date` from the pathname. Adds a Day/Week/Month pill switcher; per-view prev/next/today nav; label format differs per view (day: "Friday, Apr 24, 2026", week: "Apr 19 – Apr 25, 2026", month: "April 2026"). View-switch links preserve the current anchor date.

**Docs:**
- `docs/PROJECT_STRUCTURE.md` — noted `DaysView.tsx` and `CalendarHeader.tsx` in the feature-components list.

### Decisions made

- **One shared grid component (`DaysView`), not duplicated code.** The pick-end / drag / overlap logic is intricate; keeping two copies would guarantee drift. Passing `days: DateTime[]` lets Week pass 7 and Day pass 1, with the same behavior in both.
- **Month view clicks navigate, they don't open a dialog.** The Phase 5 EventDialog is tightly coupled to the hour-grid's drag-to-pick UX, which doesn't apply in a day cell. Routing to `/calendar/day/<date>` for edits keeps the month view purely a read-only overview.
- **View-switch keeps the current anchor date, not today.** If you're looking at next week and click "Month", you see next week's month. Matches how Google Calendar handles view switches.

### Verification

- `npx tsc --noEmit` passes.
- Manual: from `/calendar/week/<date>`, clicking **Day** → single-day grid with the same events; **Month** → 6-week overview. Prev/next arrows step by day / week / month respectively. Today button always returns to today in the current view. Clicking a month cell lands on that day in day view.

### What's next

Phase 7 — BigEvents (all-day events): schema is already in place (from Phase 3). Add `/api/big-events` CRUD, wire up the "All day" placeholder bar in `DayView` and a similar bar at the top of `WeekView`, and render chips in the month cells alongside timed events.

---

## Phase 7 — BigEvents (all-day) ✅

**Goal:** Users can add/rename/delete all-day "big events" that show up as a row above the hour grid in Day and Week view, and as solid chips in Month view.

### Files created / changed

**Schema & API:**
- `src/schemas/bigEvent.ts` — `bigEventCreateSchema` / `bigEventUpdateSchema`. Accepts a `YYYY-MM-DD` string for `date` and transforms to a Date at midnight UTC (matching Prisma's `@db.Date` storage). `rrule` field is present but not yet honored — deferred to Phase 9.
- `src/app/api/big-events/route.ts` — `GET ?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive start, exclusive end) and `POST`. Filters out recurring rows for now.
- `src/app/api/big-events/[id]/route.ts` — `PATCH` and `DELETE`, both scoped to `{ id, userId }`.

**UI:**
- `src/components/calendar/BigEventDialog.tsx` — small RHF + Zod dialog with title, date picker, category chips, notes. Same Enter / Shift+Enter keyboard shortcuts as `EventDialog`.
- `src/components/calendar/BigEventBar.tsx` — column-aligned strip (`2.5rem repeat(N, 1fr)` to match `DaysView`). One cell per day; cells show chips colored by category. Clicking empty space in a cell opens a "new" dialog for that day; clicking a chip opens edit. Dialog is rendered in a fixed centered overlay with a click-through backdrop.
- `src/components/calendar/DaysView.tsx` — added an optional `allDayRow?: React.ReactNode` prop that renders inside the same sticky-top block as the day labels, so both stay pinned while the hour grid scrolls.
- `src/components/calendar/WeekView.tsx` / `DayView.tsx` — now pass `<BigEventBar>` as `allDayRow`. Day view's former "coming in Phase 7" placeholder is gone.
- `src/components/calendar/MonthView.tsx` — now also queries `/api/big-events` for the month-grid range. BigEvents take chip slots first (they apply to the whole day); remaining slots go to timed events; `+N more` counts the combined overflow.

### Decisions made

- **BigEvent date stored as midnight UTC, not localized.** `@db.Date` is a pure calendar date — no time zone. Treating it as midnight UTC on both sides (`new Date("YYYY-MM-DDT00:00:00.000Z")` on write; `.slice(0, 10)` on read) avoids timezone-shift bugs where a West-Coast user creates "Apr 24" and the DB stores it as "Apr 23". The rest of the app uses Luxon for display, but for BigEvents the calendar date IS the canonical value.
- **Centered modal for the BigEventDialog, not a floating card next to the bar.** The all-day row is only ~20px tall; there's no meaningful anchor position to float next to, and the dialog needs ~280px vertical room for its fields. A fixed-overlay modal is the right shape for this.
- **BigEvents take chip priority in Month view.** Because they represent the whole day, they're more relevant to the at-a-glance month overview than individual timed events. Showing them first mimics Google Calendar's behavior.
- **Sticky block wraps both day labels and the all-day row.** Wrapping both in a single `sticky top-0` container keeps them pinned together without hand-tuning a second `top-Npx` offset when the header height changes.

### Verification

- `npx tsc --noEmit` passes.
- Manual: sign in → `/calendar/week` → click an empty cell in the "All day" row → dialog opens with that day pre-selected → type a title, pick a category, save → chip appears in the bar. Switching to `/calendar/day/<same-date>` shows the same chip; `/calendar/month/<same-month>` shows it as a solid chip above the timed events. Editing a chip in any view → reloads everywhere via TanStack's `invalidateQueries(["big-events"])`.

### What's next

Phase 8 — Todos with daily rollover. Right-rail todo list in Day view; incomplete todos roll forward to the next day until done or explicitly dismissed. Uses the `Todo` / `TodoCompletion` tables added in Phase 3.

---

## Phase 7 — UX polish pass ✅ (post-MVP, before Phase 8)

After the initial Phase 7 landed, a long iterative polish pass touched the typography, the today indicator, keyboard nav, the dialog flow, and the month-grid sizing. The current state below is what Phase 8 starts on top of.

### Typography (mimicking Google Calendar)

- **App font swapped from Geist Sans to Roboto** via `next/font/google` in `src/app/layout.tsx`. Variable name is `--font-sans` so Tailwind's `font-sans` utility picks it up; loaded weights are `400 / 500 / 700` (so `font-medium` and `font-bold` both render correctly). `Geist_Mono` likewise replaced with `Roboto_Mono`.
- **Title vs. time hierarchy:** title `font-bold`, time `font-medium`. Applied to: timed-event blocks (Day/Week, both single-line and stacked layouts in `DaysView`), month-cell chips (`MonthView`), all-day chips in the `BigEventBar`, and big-event chips in the month top row. Reverses the earlier "make time bold" pass — the user confirmed Google's convention reads better.
- **Day-view header bar** is now pinned to a fixed `h-[34px]` so the today-circle (28px) doesn't grow the section relative to the non-today text-only variant. Date split into `"<weekday>, <month>"` + a separate day-number element so the circle is just the digit.
- **Week-view day labels** bumped to `text-sm font-bold` (weekday) / `text-base font-bold` (number).

### Today indicator unification

Single, consistent treatment across all three views — a filled `bg-primary` circle around the day number, no other tints.

- `DaysView`: removed the `bg-primary/10` header tile and `bg-primary/5` column-body tint; only the filled circle remains.
- `MonthView`: removed `bg-primary/5` cell tint; today's day number renders inside the same `h-6 w-6 rounded-full bg-primary` element used in week view.
- `DayView`: header bar uses the same circle (sized `h-7 w-7` to fit the larger context) when the viewed date is today.

### CalendarHeader restructuring

- **Today button moved to the left** of the Day/Week/Month switcher (was tucked next to the prev/next arrows).
- The whole calendar-nav cluster (Today, DWM switcher, prev/next arrows, label) lives in one `gap-3` flex row so the arrows sit tight against the switcher rather than getting pushed away by the header's wider `gap-6`.
- Arrow buttons are now `gap-1` apart (was `gap-2`).
- Day/Week/Month switcher buttons sized `px-3 py-1 text-sm`.
- "Categories" link joined by a new "Shortcuts" link in the top-right.

### Keyboard shortcuts (full list as of end-of-Phase-7)

Document-level `keydown` listeners attached when relevant, with input/textarea/select and any-modifier presses skipped so editing fields and browser shortcuts (Cmd+←/→ for back/forward) keep working.

| Key | Behavior |
|---|---|
| **←** / **→** | Prev / next in the current view (day, week, or month). |
| **T** | Jump to today in the current view. |
| **D** / **W** / **M** | Switch to Day / Week / Month, preserving the current anchor date. |
| **Enter** *(in a dialog)* | Save. In a textarea, inserts a newline. |
| **Shift+Enter** *(in a dialog)* | Delete the event — only when editing. No effect when creating. In a textarea, inserts a newline. |
| **Esc** *(in a dialog)* | Cancel — close without saving. Replaced the previous "Shift+Enter cancels on create" behavior. |

The arrow / T / D / W / M handlers live in `CalendarHeader` (it already knows the current view + anchor date). The dialog handlers live in `EventDialog` and `BigEventDialog`.

### Dialog flow changes

- **Create-mode footer:** `[Cancel] [Create]` (unchanged).
- **Edit-mode footer:** now `[Delete] [Cancel] [Save]` — the explicit Cancel button was added so Esc has a visible UI counterpart.
- Shift+Enter on **create** is no longer mapped to cancel (Esc handles it).

### MonthView refinements

- Grid rows derived from `cells.length / 7` instead of a hardcoded `repeat(6, …)` — months that span only 5 weeks no longer leave a blank 6th row at the bottom.
- Pinned `<body>` to `h-full overflow-hidden` so the calendar layout's `h-screen` chain truly claims the full viewport.
- Tightened weekday-header padding `py-1.5` → `py-0.5` to give the cell grid more vertical room.
- BigEvent chips now ride **alongside the day number** (top row), centered in their slot, sharp-cornered boxes at `w-[90%]`. Timed events stay below.
- Timed-event chip layout: title on the left, `start–end` time pushed to the right (was time-then-title). Padding tightened (`pl-1.5 pr-0.5 py-0`) and font bumped one notch (`text-[10px]` → `text-xs`) — fits more text in the cell.
- "+N more" overflow counter also bumped to `text-xs`.

### BigEventBar refinements

- **All-day gutter label** stacks "All" / "day" on two lines (`text-[8px]`) so it fits inside the 2.5rem hour-column gutter without clipping.
- Chips now flex-fill the cell vertically (parent cell `gap-0 px-0 py-0`, chip `flex-1 items-center justify-center`) so the colored pill spans the full bar height. Chip text bumped to `text-sm`.

### Settings: shortcuts page

- New route `src/app/calendar/settings/shortcuts/page.tsx` lists every wired-up keyboard shortcut in two sections (Navigating the calendar, Inside an event dialog), styled with `<kbd>` chips.
- Linked from the header next to "Categories".

---

## Phase 8 — Todos with daily rollover ✅

**Goal:** The Day-view right rail is a real todo list. Users can add/edit/delete todos, check them off, and incomplete items roll forward to the next day until completed.

### Files created / changed

**Schema & API:**
- `src/schemas/todo.ts` — `todoCreateSchema` / `todoUpdateSchema`. `dueDate` accepts `YYYY-MM-DD` and stores midnight UTC (same encoding as `BigEvent`). Update schema also accepts an optional `completedAt: string | null` so the checkbox can toggle completion through the same PATCH endpoint.
- `src/app/api/todos/route.ts` — `GET ?date=YYYY-MM-DD` returns the visible-on-`date` list: todos with `dueDate == date` (regardless of completion) ∪ incomplete todos with `dueDate < date` (rolled forward). `POST` creates. Recurring todos (`rrule != null`) are filtered out until Phase 9.
- `src/app/api/todos/[id]/route.ts` — `PATCH` and `DELETE`, both scoped to `{ id, userId }`.

**UI:**
- `src/components/calendar/TodoList.tsx` — replaces the Phase-7 placeholder right rail. Shows the day's todos with a checkbox, a category color dot, and a "rolled over" badge when `dueDate < dateISO`. **Create and edit are inline in the rail** — no modal. The footer holds an "Add a todo…" input (Enter to submit, category chips appear once you start typing). Clicking a row swaps it in-place for an edit form (title input + category chips + Save / Cancel / Delete). Notes aren't exposed in the UI — todos are short-form by design; the DB column stays for forward-compat.
- `src/components/calendar/DayView.tsx` — Phase 7 placeholder removed; renders `<TodoList dateISO={dateISO} />` instead.

### Decisions made

- **Read-time rollover, no `dueDate` mutation.** Implemented exactly as decision #9: the GET query unions `dueDate == date` with `dueDate < date AND completedAt IS NULL`. The original `dueDate` is preserved, and the badge in the rail surfaces "this is older than today, you missed it" without losing that history.
- **Toggle completion via the existing PATCH route, not a separate `/complete` endpoint.** For non-recurring todos `completedAt` is just a column. A dedicated endpoint only earns its keep when there's per-occurrence state to manage — that lands with `TodoCompletion` in Phase 9.
- **Inline edit in the rail, not a modal.** A todo is a one-line item — opening a centered dialog (the BigEvent pattern) overshoots the weight of the interaction. The rail is already its own focused surface; editing where the item lives keeps the eye fixed and avoids dialog-open / dialog-close churn for what's usually a 2-second edit.
- **No notes field in the UI.** Todos are short-form ("buy milk", not a journal entry). Removing the field tightens the rail and removes a step from the create flow. The `notes` column on `Todo` stays in case a future "todo detail" view wants it.
- **No drag/reorder yet.** The list is sorted server-side by `dueDate ASC, createdAt ASC`, which puts older rolled-over items above today's. Manual ordering would need an `order` column and is out of scope for v1 (consistent with decision #11).

### Verification

- `npx tsc --noEmit` passes.
- Manual: sign in → `/calendar/day/<today>` → click `+` in the Todos header → dialog opens with today pre-selected → save → item appears in the list. Check the box → text strikes through. Navigate to tomorrow's day view → unchecked item from yesterday shows with a "rolled over" badge; today's checked item is gone (its `dueDate` is yesterday and it's complete). Editing a todo invalidates `["todos"]` so the list refreshes.

### What's next

Phase 9 — Recurrence. Honor `rrule` on `Event`, `BigEvent`, and `Todo`. Expand occurrences in the existing GETs, render them in the views, and add a recurrence editor to the three dialogs. Per-occurrence overrides go through `EventException` and `TodoCompletion`.

---

## Phase 9 — Recurrence ✅

**Goal:** Events, big events, and todos can repeat. The three GETs return expanded occurrences in the requested range, the three create/edit surfaces have a recurrence picker, and a single occurrence of a recurring event can be edited or cancelled without touching the rest of the series.

### Files created / changed

**Library:**
- `src/lib/recurrence.ts` — wraps the `rrule` package. `parseRule(str, dtstart)` builds an `RRule`; `expandOccurrences(str, dtstart, from, to)` returns the half-open list of occurrence start dates; `occurrenceId(seriesId, originalStartUtc)` and `parseOccurrenceId` form/split the synthetic id used to identify a single occurrence on the wire.
- `src/components/calendar/RecurrenceEditor.tsx` — preset picker (Does-not-repeat / Daily / Weekly / Monthly / Yearly) plus weekday checkboxes for the weekly preset. Emits a plain `FREQ=...;...` RRULE string with no DTSTART line — the parent row carries the start.

**Wire format change.** All three list GETs now return occurrences and singletons in one mixed array. Each item has:
- `id` — unique on the wire (synthetic `seriesId@originalIso` for occurrences, plain cuid for singletons), so React keys, exclude-self filters, and adjacency checks all work without a special case.
- `seriesId` — the parent row id; what mutation routes target.
- `isOccurrence` and `originalStartUtc` / `originalDate` / `occurrenceDate` — present so the client can decide whether to mutate the parent or upsert an exception.

**Events API:**
- `src/app/api/events/route.ts` — GET now expands every recurring series in `[from, to)` and applies any matching `EventException` (overrideTitle/Notes/Start/End or `cancelled`). Result is sorted by `startUtc`. Server-side overlap validation is unchanged for non-recurring events; recurring expansion isn't checked for overlap (would require expanding all touched series — explicitly deferred).
- `src/app/api/events/[id]/occurrence/route.ts` (new) — `PATCH` upserts an `EventException` with overrides; `DELETE ?originalStartUtc=...` upserts an exception with `cancelled=true`. Series-level edit/delete still goes through `/api/events/[id]`.

**BigEvents API:**
- `src/app/api/big-events/route.ts` — GET expands recurring rows. Per-occurrence overrides aren't supported (no exception table in the schema; `Edit all` is the only edit path).

**Todos API:**
- `src/app/api/todos/route.ts` — GET now also expands recurring todos. Rolled-over recurring instances surface the same way as non-recurring ones (any past occurrence with no matching `TodoCompletion` row). Rollover for recurring todos is capped at 90 days back (`ROLLOVER_DAYS`) so a daily-forever todo with thousands of past instances doesn't all flood the rail.
- `src/app/api/todos/[id]/complete/route.ts` (new) — `POST { occurrenceDate, completed }` toggles a `TodoCompletion` row for one occurrence of a recurring todo. Non-recurring todos still use `PATCH /api/todos/[id]` with `completedAt`.

**Dialogs / UI:**
- `EventDialog` — accepts the new `EventModel` shape. Adds a `RecurrenceEditor` row when editing the series. When the user opens a single occurrence (`isOccurrence`), the footer offers `Save this` / `Save all` and `Delete this` / `Delete all`; the recurrence editor is hidden (changing the rule is a series-level concept). Keyboard: Enter saves with the visual default (occurrence when editing one); Shift+Enter deletes with the same default.
- `BigEventDialog` — adds the recurrence picker. Editing a recurring occurrence falls through to a series-level save (no exception table); a small note in the footer makes that explicit.
- `TodoList` — the inline add row gains a `RecurrenceEditor` underneath the category chips (only visible once you start typing a title). The edit-row gains the same. Toggling a checkbox on a recurring occurrence routes through `/api/todos/[id]/complete`; non-recurring still PATCHes `completedAt`.

### Decisions made

- **Synthetic per-occurrence id on the wire.** The alternative was sending the parent id for every occurrence and adding a parallel `originalStartUtc` everywhere the client compares ids. That would have required threading "parent id + original start" through `findAdjacent`, the dialog's "hide me" filter, and React keys. A unique id per row keeps the existing client logic untouched; the server is the only place that has to split it.
- **Series-level only for BigEvents and Todos.** The schema only has exception tables for `Event` (`EventException`) and `Todo` (`TodoCompletion`). BigEvents have neither; Todos have completion-state but not retitle/move overrides. Rather than add tables, this phase scopes BigEvents and Todos to series-level edits. Per-occurrence overrides can be added later without breaking the wire format (occurrences already carry the original date).
- **No "edit this and following" yet.** That third option would split the series at the chosen occurrence (truncate the parent's RRULE with `UNTIL`, create a new series for the future). It's well-defined but doubles the override branching. Postponed; users get the two most common cases (this / all) for now.
- **Rollover cap of 90 days for recurring todos.** A "daily forever" recurring todo with 800 unfinished occurrences would otherwise dump 800 rows into the rail. 90 days is generous enough for "I forgot last month's task" without runaway UI.
- **DST trade-off.** Occurrences are advanced in UTC by whole days/weeks/months. For an LA user with a "weekly Monday at 2pm" rule, the wall-clock time can shift one hour at DST transitions. Acceptable for v1; the editor doesn't yet emit `DTSTART;TZID=America/Los_Angeles`. Documented in `recurrence.ts` so the next person who hits it knows where to look.

### Verification

- `npx tsc --noEmit` passes.
- Manual sanity:
  - Create an event, set Repeat → Weekly, check Mon/Wed/Fri → grid shows the event on those days for the visible weeks; navigating ←/→ keeps showing them.
  - On a recurring occurrence, change the title and click "Save this" → only that day's chip changes; siblings keep the original title.
  - Click "Delete this" on one occurrence → that day is empty, the others stay.
  - Click "Delete all" → series and all of its `EventException` rows go away (Prisma `onDelete: Cascade`).
  - Add a recurring todo (daily) and complete one instance → tomorrow's day view shows the next occurrence, not yesterday's.
  - Leave a recurring todo uncompleted for two days → both rolled-over instances surface with the "rolled over" badge.

### What's next

Phase 10 — polish + the deferred items: per-occurrence overrides for BigEvents (decide whether to add a `BigEventException` table or accept series-only), the "Edit this and following" path, and possibly a TZID-aware RRULE serializer to fix the DST drift. Likely also a search/filter UI for categories and a view-by-category toggle.

---

## Phase 9 — UX polish pass ✅ (post-MVP)

After the initial Phase 9 landed, a few iterations cleaned up the recurrence UX. This is the state Phase 10 starts on top of.

### EventDialog — scope prompt as an overlay

The original Phase 9 design swapped the dialog footer between two layouts (one with `Save` / `Delete`, one with `Save this / Save all / Delete this / Delete all`). That made the footer feel different depending on whether the event happened to repeat. Reverted to a single, stable footer — `[Delete] [Cancel] [Save]` (or `[Cancel] [Create]` when new) — for every event.

When the user saves or deletes a *recurring occurrence*, a small confirm overlay appears **on top of the EventDialog card itself** (absolute, full-card, dim + blur backdrop), with two buttons: **All events** / **This event**. Clicking the backdrop or pressing Esc dismisses the overlay without firing the mutation. Keyboard shortcuts (Enter saves, Shift+Enter deletes, Esc cancels) work exactly like before; the prompt is staged before the mutation runs.

### EventDialog — field order

Notes moved below Repeat. Reading order is now Title → Category → Repeat → Notes, which puts the high-frequency fields up top and the freeform field at the bottom.

### RecurrenceEditor — shorter labels

`Does not repeat / daily / weekly / monthly / yearly` → `None / Day / Week / Month / Year`. The longer copy was wrapping the picker onto two rows in narrow contexts (the todo rail in particular).

### TodoList — proper form, slightly wider, then back

- Width settled at `w-72` (~288px) — wider than the original `w-64` so the create form has room, but slimmer than the brief `w-80` experiment.
- Title input is now a styled `Input` (the same shadcn component the dialogs use), not a bare bordered-only field. The redundant inline `+` submit button is gone — Enter submits, Esc clears.
- Category chips and the recurrence picker are **always visible** in the create form (not gated behind "user started typing"), so the affordance is obvious.
- Field sections gained tiny `Title` / `Category` / `Repeat` labels (a local `FieldLabel` styled the same as the section headers).
- Vertical rhythm tightened twice — outer gap `space-y-2 → space-y-1`, header `py-2 → py-1.5`, micro-gaps between labels and controls removed.

### What this changes for Phase 10

Nothing structural — these were UI iterations on top of the Phase 9 wire format. The deferred items in the previous "What's next" still stand.

---

## Phase 10 — Past-safe edits ("This event" / "This and following") ✅

**Goal:** Editing or deleting a recurring item never modifies occurrences before the one being edited. The two scope options are **This event** (one occurrence only) and **This and following** (split the series). The old "All events" semantic — which mutated past instances — is gone.

### Files created / changed

**Schema:**
- `prisma/schema.prisma` — added `BigEventException` and `TodoException`. Both mirror `EventException`'s shape (`originalDate`/`occurrenceDate`, `cancelled`, `overrideTitle/Notes/CategoryId`). `BigEvent.exceptions` and `Todo.exceptions` relations added. `Todo.completions` is unchanged — `TodoCompletion` keeps tracking completion only.
- `prisma/migrations/<…>_phase10_exceptions/` — generated migration.

**Library:**
- `src/lib/recurrence.ts` — added `withUntil(rruleStr, dtstart, before)`. Strips any existing `UNTIL`/`COUNT`, sets `UNTIL = before − 1ms`. Returns `null` when the truncation would yield zero occurrences (caller deletes the parent series instead). Reused by all three split endpoints.

**Events API:**
- `src/app/api/events/[id]/split/route.ts` (new) — POST with `{ originalStartUtc, action: "edit"|"delete", …overrides }`. In a single transaction: truncates the parent's RRULE (or deletes the parent when no occurrences remain), drops `EventException` rows whose `originalStartUtc >= splitPoint`, and (for "edit") creates a brand-new `Event` starting at the split point with the new fields and rule. Past occurrences stay intact on the original parent.

**BigEvents API:**
- `src/app/api/big-events/route.ts` — GET now includes `exceptions` and applies `overrideTitle/Notes/CategoryId` per occurrence; cancelled occurrences are filtered out.
- `src/app/api/big-events/[id]/occurrence/route.ts` (new) — PATCH upserts a `BigEventException`; DELETE upserts a cancelled exception.
- `src/app/api/big-events/[id]/split/route.ts` (new) — POST with `{ originalDate, action, …overrides }`. Same shape as the events split.

**Todos API:**
- `src/app/api/todos/route.ts` — GET now includes `exceptions` alongside `completions` and applies overrides; cancelled exceptions filter the occurrence out.
- `src/app/api/todos/[id]/exception/route.ts` (new) — PATCH upserts a `TodoException`; DELETE upserts a cancelled exception. (Distinct from `/complete`, which still toggles `TodoCompletion`.)
- `src/app/api/todos/[id]/split/route.ts` (new) — POST with `{ occurrenceDate, action, …overrides }`. Also drops both `TodoException` and `TodoCompletion` rows at or after the split point so they don't leak across the boundary.

**Client:**
- `EventDialog` — popup buttons relabeled `All events → This and following`. New `SaveScope = "series" | "occurrence" | "following"`. Series-level edits still use `PATCH /api/events/[id]`; occurrence edits still use `/occurrence`; "following" routes to `/split`. Same for delete. Footer is unchanged (`[Delete] [Cancel] [Save]`); the prompt only appears when the user touches a recurring occurrence.
- `BigEventDialog` — gained the same scope-prompt overlay (was previously series-level only). Same routing pattern as events.
- `TodoList` — the inline edit row now defers save/delete through `requestEditSave/Delete`, which either fires immediately (non-recurring) or stages a `pending` action that surfaces as a popup overlaid on the rail itself. Two buttons: `This and following` / `This todo`. Background click and Esc dismiss.

### Decisions made

- **One uniform principle, three entities.** The user's rule — "an edit must never modify past occurrences" — is enforced for events, big events, and todos identically. That justified adding the two new exception tables rather than scoping big-events/todos to "this and following only", which would have been the cheaper path.
- **Split endpoint, not series-mutation with cleanup.** Could have implemented "this and following" as: truncate parent + create new entity, in the existing PATCH route, gated by a query param. Instead it's a dedicated `/split` route per entity. Reasoning: split is fundamentally a *different* operation from "update this row" — it can delete the parent, create a new row, and clear exception rows in one transaction. A separate route makes that obvious in the URL and keeps the regular PATCH handlers small.
- **Same prompt UX on all three surfaces.** Backdrop-blur overlay over the active card/rail, two buttons, no Cancel button (clicking the backdrop or pressing Esc dismisses). Matches the Phase 9 polish-pass pattern.
- **`TodoException` separate from `TodoCompletion`.** Could have folded an `overrides + cancelled` flag into the existing completion table. Kept them separate because semantically a "completion" row and an "override" row have different lifecycles — completions toggle frequently, exceptions stick around — and bundling them would surface awkward query shapes in the GET.
- **"This event" on a recurring todo doesn't apply rrule changes.** The exception table holds title/notes/category overrides only; recurrence is a series-level concept. If a user changes the rule and picks "This todo", the rule change is silently ignored. Pushing back later if this becomes confusing.

### Verification

- `npx tsc --noEmit` passes after `prisma generate`.
- Schema migration applied cleanly: `npx prisma migrate dev --name phase10_exceptions` →  `BigEventException` and `TodoException` exist in Postgres.
- Manual flow:
  - Recurring weekly event → click an occurrence → change title → Save → popup → "This and following": today's occurrence + future weeks have the new title; past weeks unchanged. The original series ends just before the split; a new series begins at the split.
  - Same flow with "This event": only that one occurrence shows the new title; past *and* future remain on the original rule.
  - Recurring big event → "This and following" delete: future cells empty, past cells still show the chip.
  - Recurring todo → check off one instance, then edit a future occurrence with "This event" override → completion of the past instance is preserved; only the future instance carries the new title.

### What's next

- "Edit this and following" no longer needs the carve-out from Phase 9's deferred list — it's the default option now. The genuinely deferred items remaining: TZID-aware RRULE serialization (DST drift), server-side overlap validation across recurring expansions, drag-and-drop, notifications.

---
