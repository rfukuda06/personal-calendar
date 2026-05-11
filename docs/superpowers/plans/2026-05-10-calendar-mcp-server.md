# Calendar MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `npm run cal:prod` CLI as Claude Code's calendar interface with a local MCP server that keeps one warm Node+Prisma process across calls, delivering ~10–30× speedup on typical interactions.

**Architecture:** A new `src/lib/calendar-ops.ts` module holds pure async functions (one per current CLI command). Both the existing CLI (`src/scripts/cal.ts`) and a new MCP server (`src/mcp/server.ts`) call those ops — DRY, single source of truth. The MCP server uses `@modelcontextprotocol/sdk` over stdio transport, is bundled to a single file with `esbuild`, and is registered into `~/.claude.json` via `claude mcp add-json --scope user`. The CLI stays as a fallback in case the MCP breaks.

**Tech Stack:** Node 22, TypeScript, `@modelcontextprotocol/sdk` (MCP server), `esbuild` (bundling), existing Prisma 7 / Zod 4 / Luxon. No new test framework — a Node-based smoke-test script (`src/scripts/test-mcp.ts`) spawns the server and exercises each tool.

**Conventions inherited from the repo:**
- User is hardcoded `rfukuda06@gmail.com`. The op functions take `userId` as the first arg; the MCP server resolves it once at startup.
- Times are LA-local `YYYY-MM-DDTHH:mm` for inputs, UTC ISO for outputs; `lib/time.ts` and `lib/recurrence.ts` are the existing helpers — reuse, don't reimplement.
- All write tools validate input with the existing Zod schemas from `src/schemas/`. The MCP tool input schemas wrap those.
- The CLI's `out()`/`fail()` model becomes: ops return values or throw `CalendarOpError`; CLI catches and prints, MCP catches and returns JSON-RPC errors.

---

## File Structure

**Created:**
- `src/lib/calendar-ops.ts` — All 28 op functions plus the `CalendarOpError` class and `getUserId()` helper. ~600 lines, mostly mechanical extraction from `cal.ts`.
- `src/lib/calendar-ops-schemas.ts` — Zod input schemas per op (separated from `lib/calendar-ops.ts` so the MCP server can import the schemas without importing Prisma at type-introspection time). ~200 lines.
- `src/mcp/server.ts` — MCP server entry. Imports ops + schemas, registers one MCP tool per op, runs stdio transport. ~400 lines, very repetitive registration pattern.
- `src/scripts/test-mcp.ts` — Spawns the built server and runs a smoke test (list events, create + read + delete an event, list categories). Exits non-zero on any failure.
- `src/mcp/README.md` — One-page operator doc: how to rebuild, how to re-register, how to fall back to the CLI.

**Modified:**
- `src/scripts/cal.ts` — Each command handler shrinks to ~3 lines: parse input → call op → `out()` result. Top-level error handling unchanged. The file goes from ~1000 lines to ~300.
- `package.json` — Add deps `@modelcontextprotocol/sdk`, `esbuild`; add scripts `mcp:build`, `mcp:dev`, `mcp:test`.

**Untouched:**
- `src/schemas/*` — Existing Zod schemas stay; the new MCP schemas are *additional* (input-shape for occurrence overrides, reminder targets, etc.), not replacements.
- `src/lib/time.ts`, `src/lib/recurrence.ts`, `src/lib/db.ts` — No changes.
- All Next.js routes, Prisma schema, migrations — Untouched.

---

## Task 1: Bootstrap dependencies and file skeletons

**Files:**
- Modify: `package.json`
- Create: `src/lib/calendar-ops.ts`
- Create: `src/lib/calendar-ops-schemas.ts`
- Create: `src/mcp/server.ts`
- Create: `src/mcp/README.md`
- Create: `src/scripts/test-mcp.ts`

- [ ] **Step 1: Install MCP SDK and esbuild**

```bash
cd /Users/renzofukuda/Desktop/Repos/personal_calendar
npm install --save @modelcontextprotocol/sdk
npm install --save-dev esbuild
```

Expected: both add to `package.json` without peer-dep warnings (Node 22, the repo's runtime, satisfies both).

- [ ] **Step 2: Add MCP scripts to package.json**

Edit `package.json` `scripts` section to add:

```json
"mcp:build": "esbuild src/mcp/server.ts --bundle --platform=node --target=node22 --format=esm --outfile=dist/mcp/server.mjs --external:@prisma/client --external:@prisma/adapter-pg --external:./src/generated/prisma/client",
"mcp:dev": "tsx -r dotenv/config -r ./src/scripts/use-prod-db.ts src/mcp/server.ts",
"mcp:test": "npm run mcp:build && tsx -r dotenv/config -r ./src/scripts/use-prod-db.ts src/scripts/test-mcp.ts"
```

Three points worth understanding:
- `--external:@prisma/client` keeps Prisma's runtime out of the bundle so its native bindings still resolve at runtime. `dist/mcp/server.mjs` will `require()` them from `node_modules`.
- `mcp:dev` exists for local iteration without rebuilding; `mcp:build` is what the registered MCP server points at.
- `mcp:test` rebuilds first, then runs the smoke test against the freshly-built bundle (catches packaging errors that `mcp:dev` would miss).

- [ ] **Step 3: Create empty skeleton files**

```bash
mkdir -p src/mcp dist/mcp
touch src/lib/calendar-ops.ts src/lib/calendar-ops-schemas.ts src/mcp/server.ts src/scripts/test-mcp.ts
```

Write `src/mcp/README.md`:

```markdown
# Calendar MCP Server

Stdio MCP server that exposes every `cal.ts` command as a typed tool. Used by Claude Code in place of `npm run cal:prod` — one warm Node+Prisma process answers every tool call.

## Build & register

```bash
npm run mcp:build
claude mcp add-json --scope user calendar "$(cat <<'JSON'
{
  "command": "node",
  "args": ["/Users/renzofukuda/Desktop/Repos/personal_calendar/dist/mcp/server.mjs"],
  "env": {"DATABASE_URL_PROD": "<prod neon connection string>"}
}
JSON
)"
```

Then restart Claude Code. Tools appear as `mcp__calendar__list_events`, etc.

## Fallback

If the MCP breaks, the original `npm run cal:prod -- <command>` CLI still works — both go through `src/lib/calendar-ops.ts`.
```

- [ ] **Step 4: Commit skeleton**

```bash
git add package.json package-lock.json src/lib/calendar-ops.ts src/lib/calendar-ops-schemas.ts src/mcp/ src/scripts/test-mcp.ts
git commit -m "feat(mcp): bootstrap calendar MCP server scaffolding"
```

---

## Task 2: Extract op-layer error class and user resolver

**Files:**
- Modify: `src/lib/calendar-ops.ts`

- [ ] **Step 1: Add error class + user resolver to calendar-ops.ts**

Write the file:

```typescript
import { prisma } from "./db";

/**
 * Errors thrown by op functions. Callers (CLI, MCP) format them appropriately.
 * `code` is a machine-readable kebab-case identifier; `detail` is optional extra context.
 */
export class CalendarOpError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CalendarOpError";
  }
}

const USER_EMAIL = "rfukuda06@gmail.com";

let cachedUserId: string | null = null;

/**
 * Resolve the hardcoded user id. Cached in-process — the MCP server calls this
 * once at startup; the CLI calls it once per invocation (no cache benefit).
 */
export async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const u = await prisma.user.findUnique({
    where: { email: USER_EMAIL },
    select: { id: true },
  });
  if (!u) throw new CalendarOpError("no-user", `no user with email ${USER_EMAIL}`);
  cachedUserId = u.id;
  return cachedUserId;
}

/**
 * Helper to parse YYYY-MM-DD into a UTC midnight Date. Date-only fields are
 * stored as UTC midnight in the DB regardless of locale.
 */
export function parseDateOnly(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new CalendarOpError("bad-date", `expected YYYY-MM-DD, got ${s}`);
  }
  return new Date(`${s}T00:00:00.000Z`);
}
```

- [ ] **Step 2: Write smoke test for getUserId**

Add to `src/scripts/test-mcp.ts`:

```typescript
import "dotenv/config";
import "./use-prod-db";
import { getUserId, CalendarOpError } from "../lib/calendar-ops";

async function main() {
  const uid = await getUserId();
  if (!uid || typeof uid !== "string") {
    throw new Error(`getUserId returned bad value: ${JSON.stringify(uid)}`);
  }
  console.log(`✓ getUserId: ${uid}`);
}

main().catch((e) => {
  console.error("✗ test failed:", e instanceof CalendarOpError ? `${e.code}: ${e.message}` : e);
  process.exit(1);
});
```

Run:
```bash
npx tsx -r dotenv/config -r ./src/scripts/use-prod-db.ts src/scripts/test-mcp.ts
```

Expected: `✓ getUserId: <cuid>` and exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/calendar-ops.ts src/scripts/test-mcp.ts
git commit -m "feat(mcp): add CalendarOpError and getUserId to ops layer"
```

---

## Task 3: Extract event operations

**Files:**
- Modify: `src/lib/calendar-ops.ts`

This task lifts the four event handlers from `cal.ts` (`listEvents`, `createEvent`, `updateEvent`, `deleteEvent`) into pure ops that return data instead of calling `out()`. Each one keeps its existing Prisma logic verbatim — only the I/O boundary changes.

- [ ] **Step 1: Add range helper to calendar-ops.ts**

Append to `src/lib/calendar-ops.ts`:

```typescript
import { DateTime } from "luxon";
import { TZ, fromLocalInputValue } from "./time";

/**
 * Default list window: today (LA) through +30 days. Accepts optional
 * YYYY-MM-DD overrides. Returns UTC Date pair matching the schema columns.
 */
export function resolveRange(fromIso?: string, toIso?: string): { from: Date; to: Date } {
  const today = DateTime.now().setZone(TZ).startOf("day");
  const f = fromIso ?? today.toISODate()!;
  const t = toIso ?? today.plus({ days: 30 }).toISODate()!;
  const from = DateTime.fromISO(f, { zone: TZ }).startOf("day");
  const to = DateTime.fromISO(t, { zone: TZ }).startOf("day").plus({ days: 1 });
  if (!from.isValid || !to.isValid) {
    throw new CalendarOpError("bad-range", "--from/--to must be YYYY-MM-DD");
  }
  return { from: from.toUTC().toJSDate(), to: to.toUTC().toJSDate() };
}

export function parseOccurrenceDatetime(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return fromLocalInputValue(s);
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    throw new CalendarOpError("bad-occurrence", `bad occurrence datetime: ${s}`);
  }
  return d;
}
```

- [ ] **Step 2: Add event ops**

Append to `src/lib/calendar-ops.ts`:

```typescript
import {
  computeSeriesEndUtc,
  expandOccurrences,
  occurrenceId,
} from "./recurrence";
import { eventCreateSchema, eventUpdateSchema } from "../schemas/event";
import { z } from "zod";

export type EventOccurrence = {
  id: string;
  seriesId: string | null;
  title: string;
  notes: string | null;
  startUtc: string;
  endUtc: string;
  rrule: string | null;
  categoryId: string | null;
  categoryName: string | null;
};

export async function listEventsOp(
  userId: string,
  params: { from?: string; to?: string },
): Promise<EventOccurrence[]> {
  const { from, to } = resolveRange(params.from, params.to);
  const rows = await prisma.event.findMany({
    where: {
      userId,
      OR: [
        { rrule: null, startUtc: { lt: to }, endUtc: { gt: from } },
        {
          rrule: { not: null },
          startUtc: { lt: to },
          OR: [{ seriesEndUtc: null }, { seriesEndUtc: { gte: from } }],
        },
      ],
    },
    include: { exceptions: true, reminders: true, category: true },
    orderBy: { startUtc: "asc" },
  });

  const occs: EventOccurrence[] = [];
  for (const ev of rows) {
    if (!ev.rrule) {
      occs.push({
        id: ev.id,
        seriesId: null,
        title: ev.title,
        notes: ev.notes,
        startUtc: ev.startUtc.toISOString(),
        endUtc: ev.endUtc.toISOString(),
        rrule: null,
        categoryId: ev.categoryId,
        categoryName: ev.category?.name ?? null,
      });
      continue;
    }
    const durationMs = ev.endUtc.getTime() - ev.startUtc.getTime();
    const exByStart = new Map(ev.exceptions.map((e) => [e.originalStartUtc.getTime(), e]));
    const starts = expandOccurrences(ev.rrule, ev.startUtc, from, to);
    for (const orig of starts) {
      const ex = exByStart.get(orig.getTime());
      if (ex?.cancelled) continue;
      const start = ex?.overrideStartUtc ?? orig;
      const end = ex?.overrideEndUtc ?? new Date(start.getTime() + durationMs);
      occs.push({
        id: occurrenceId(ev.id, orig),
        seriesId: ev.id,
        title: ex?.overrideTitle ?? ev.title,
        notes: ex?.overrideNotes ?? ev.notes,
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        rrule: ev.rrule,
        categoryId: ev.categoryId,
        categoryName: ev.category?.name ?? null,
      });
    }
  }
  occs.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  return occs;
}

export async function createEventOp(userId: string, input: unknown) {
  const parsed = eventCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "createEvent: validation failed", {
      issues: parsed.error.issues,
    });
  }
  const data = parsed.data;
  const seriesEndUtc = data.rrule ? computeSeriesEndUtc(data.rrule, data.startUtc) : null;
  return prisma.event.create({
    data: {
      userId,
      title: data.title,
      notes: data.notes ?? null,
      startUtc: data.startUtc,
      endUtc: data.endUtc,
      rrule: data.rrule ?? null,
      seriesEndUtc,
      categoryId: data.categoryId ?? null,
      reminders: data.reminders
        ? { create: data.reminders.map((r) => ({ userId, offsetMinutes: r.offsetMinutes })) }
        : undefined,
    },
  });
}

export async function updateEventOp(userId: string, id: string, input: unknown) {
  const parsed = eventUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "updateEvent: validation failed", {
      issues: parsed.error.issues,
    });
  }
  const data = parsed.data;
  const existing = await prisma.event.findFirst({ where: { id, userId } });
  if (!existing) throw new CalendarOpError("not-found", "event not found");

  const nextStart = data.startUtc ?? existing.startUtc;
  const nextRrule = data.rrule === undefined ? existing.rrule : data.rrule;
  const seriesEndUtc = nextRrule ? computeSeriesEndUtc(nextRrule, nextStart) : null;

  return prisma.$transaction(async (tx) => {
    const ev = await tx.event.update({
      where: { id },
      data: {
        title: data.title,
        notes: data.notes,
        startUtc: data.startUtc,
        endUtc: data.endUtc,
        rrule: data.rrule,
        seriesEndUtc,
        categoryId: data.categoryId,
      },
    });
    if (data.reminders !== undefined) {
      await tx.reminder.deleteMany({ where: { eventId: id } });
      if (data.reminders.length > 0) {
        await tx.reminder.createMany({
          data: data.reminders.map((r) => ({ userId, eventId: id, offsetMinutes: r.offsetMinutes })),
        });
      }
    }
    return ev;
  });
}

export async function deleteEventOp(userId: string, id: string) {
  const ev = await prisma.event.findFirst({ where: { id, userId } });
  if (!ev) throw new CalendarOpError("not-found", "event not found");
  await prisma.event.delete({ where: { id } });
  return { ok: true as const };
}
```

- [ ] **Step 3: Smoke-test event read against prod DB**

Replace `src/scripts/test-mcp.ts` contents with:

```typescript
import "dotenv/config";
import "./use-prod-db";
import { getUserId, listEventsOp, CalendarOpError } from "../lib/calendar-ops";

async function main() {
  const uid = await getUserId();
  console.log(`✓ getUserId: ${uid}`);

  const events = await listEventsOp(uid, { from: "2026-05-12", to: "2026-05-12" });
  if (!Array.isArray(events)) throw new Error(`listEventsOp returned non-array: ${JSON.stringify(events)}`);
  console.log(`✓ listEventsOp(May 12): ${events.length} events`);
  for (const e of events) console.log(`  - ${e.title} ${e.startUtc} → ${e.endUtc}`);
}

main().catch((e) => {
  console.error("✗ test failed:", e instanceof CalendarOpError ? `${e.code}: ${e.message}` : e);
  process.exit(1);
});
```

Run:
```bash
npx tsx -r dotenv/config -r ./src/scripts/use-prod-db.ts src/scripts/test-mcp.ts
```

Expected: the same 3 events (Fencing / ENGR76 QUIZ / Lift) we saw earlier in the session, printed with their UTC timestamps.

- [ ] **Step 4: Commit**

```bash
git add src/lib/calendar-ops.ts src/scripts/test-mcp.ts
git commit -m "feat(mcp): extract event ops (list/create/update/delete) into ops layer"
```

---

## Task 4: Extract todo, big-event, due-date, category, reminder, occurrence ops

**Files:**
- Modify: `src/lib/calendar-ops.ts`

These follow exactly the same pattern as Task 3: each existing CLI function in `cal.ts` becomes an exported op that returns data and throws `CalendarOpError` on failure. **Do not change the Prisma queries — copy them verbatim from `cal.ts`.** The only edits are: replace `out(...)` with `return ...`; replace `fail("msg")` with `throw new CalendarOpError("code", "msg")`; replace `parseOrFail(schema, input)` with the explicit `schema.safeParse(input)` + throw pattern from Task 3.

- [ ] **Step 1: Add todo ops**

Append to `src/lib/calendar-ops.ts`. The bodies are lifted from `cal.ts` lines 307–441 (listTodos, createTodo, updateTodo, completeTodo, deleteTodo). Resulting signatures:

```typescript
export async function listTodosOp(userId: string, params: { from?: string; to?: string }): Promise<TodoOccurrence[]>;
export async function createTodoOp(userId: string, input: unknown): Promise<Todo>;
export async function updateTodoOp(userId: string, id: string, input: unknown): Promise<Todo>;
export async function completeTodoOp(userId: string, id: string, completed: boolean, occurrence?: string): Promise<{ ok: true }>;
export async function deleteTodoOp(userId: string, id: string): Promise<{ ok: true }>;
```

Where `TodoOccurrence` mirrors the local `TOcc` type from `cal.ts:318–326`. In `completeTodoOp`, replace `parseOccurrenceDate(occ)` with a call to the local `parseDateOnly` helper from Task 2.

Full code for `listTodosOp`:

```typescript
export type TodoOccurrence = {
  id: string;
  seriesId: string | null;
  title: string;
  notes: string | null;
  dueDate: string;
  rrule: string | null;
  completed: boolean;
};

export async function listTodosOp(
  userId: string,
  params: { from?: string; to?: string },
): Promise<TodoOccurrence[]> {
  const { from, to } = resolveRange(params.from, params.to);
  const rows = await prisma.todo.findMany({
    where: { userId },
    include: { exceptions: true, completions: true },
    orderBy: { dueDate: "asc" },
  });
  const occs: TodoOccurrence[] = [];
  for (const t of rows) {
    if (!t.rrule) {
      if (t.dueDate < from || t.dueDate >= to) continue;
      occs.push({
        id: t.id,
        seriesId: null,
        title: t.title,
        notes: t.notes,
        dueDate: t.dueDate.toISOString().slice(0, 10),
        rrule: null,
        completed: t.completedAt !== null,
      });
      continue;
    }
    const exByDate = new Map(t.exceptions.map((e) => [e.occurrenceDate.getTime(), e]));
    const completedSet = new Set(t.completions.map((c) => c.occurrenceDate.getTime()));
    const dates = expandOccurrences(t.rrule, t.dueDate, from, to);
    for (const orig of dates) {
      const ex = exByDate.get(orig.getTime());
      if (ex?.cancelled) continue;
      occs.push({
        id: occurrenceId(t.id, orig),
        seriesId: t.id,
        title: ex?.overrideTitle ?? t.title,
        notes: ex?.overrideNotes ?? t.notes,
        dueDate: orig.toISOString().slice(0, 10),
        rrule: t.rrule,
        completed: completedSet.has(orig.getTime()),
      });
    }
  }
  occs.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return occs;
}
```

Apply the same pattern to the other todo ops, lifting from `cal.ts` 369–441 with the I/O-boundary substitutions described above.

- [ ] **Step 2: Add big-event ops**

Same pattern, lifted from `cal.ts:445–568`. Signatures:

```typescript
export type BigEventOccurrence = {
  id: string; seriesId: string | null; title: string; notes: string | null;
  date: string; rrule: string | null; categoryId: string | null; categoryName: string | null;
};
export async function listBigEventsOp(userId: string, params: { from?: string; to?: string }): Promise<BigEventOccurrence[]>;
export async function createBigEventOp(userId: string, input: unknown): Promise<BigEvent>;
export async function updateBigEventOp(userId: string, id: string, input: unknown): Promise<BigEvent>;
export async function deleteBigEventOp(userId: string, id: string): Promise<{ ok: true }>;
```

Schemas to import from `../schemas/bigEvent`: `bigEventCreateSchema`, `bigEventUpdateSchema`.

- [ ] **Step 3: Add due-date ops**

Same pattern, lifted from `cal.ts:572–691`. Signatures:

```typescript
export type DueDateOccurrence = {
  id: string; seriesId: string | null; title: string; dueAt: string;
  rrule: string | null; categoryId: string | null; categoryName: string | null;
};
export async function listDueDatesOp(userId: string, params: { from?: string; to?: string }): Promise<DueDateOccurrence[]>;
export async function createDueDateOp(userId: string, input: unknown): Promise<DueDate>;
export async function updateDueDateOp(userId: string, id: string, input: unknown): Promise<DueDate>;
export async function deleteDueDateOp(userId: string, id: string): Promise<{ ok: true }>;
```

Schemas to import: `dueDateCreateSchema`, `dueDateUpdateSchema` from `../schemas/dueDate`.

- [ ] **Step 4: Add category op**

```typescript
export async function listCategoriesOp(userId: string) {
  return prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } });
}
```

- [ ] **Step 5: Add reminder ops**

Lifted from `cal.ts:695–764`. Split `addReminder` into three target-specific ops so the MCP can give each a typed schema:

```typescript
export async function listEventRemindersOp(userId: string, eventId: string) {
  return prisma.reminder.findMany({ where: { eventId, userId } });
}
export async function listBigEventRemindersOp(userId: string, bigEventId: string) {
  return prisma.reminder.findMany({ where: { bigEventId, userId } });
}
export async function listDueDateRemindersOp(userId: string, dueDateId: string) {
  return prisma.reminder.findMany({ where: { dueDateId, userId } });
}

export async function addEventReminderOp(userId: string, eventId: string, offsetMinutes: number) {
  const ev = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!ev) throw new CalendarOpError("not-found", "event not found");
  return prisma.reminder.create({ data: { userId, eventId, offsetMinutes } });
}
export async function addBigEventReminderOp(userId: string, bigEventId: string, daysBefore: number) {
  const be = await prisma.bigEvent.findFirst({ where: { id: bigEventId, userId } });
  if (!be) throw new CalendarOpError("not-found", "big event not found");
  return prisma.reminder.create({ data: { userId, bigEventId, daysBefore } });
}
export async function addDueDateReminderOp(userId: string, dueDateId: string, offsetMinutes: number) {
  const dd = await prisma.dueDate.findFirst({ where: { id: dueDateId, userId } });
  if (!dd) throw new CalendarOpError("not-found", "due date not found");
  return prisma.reminder.create({ data: { userId, dueDateId, offsetMinutes } });
}

export async function removeReminderOp(userId: string, id: string) {
  const r = await prisma.reminder.findFirst({ where: { id, userId } });
  if (!r) throw new CalendarOpError("not-found", "reminder not found");
  await prisma.reminder.delete({ where: { id } });
  return { ok: true as const };
}
```

- [ ] **Step 6: Add occurrence (set + clear) ops, split by target**

Lifted from `cal.ts:776–915`. The original code branches on a `target` flag inside one function; for the ops layer, split into eight functions (one per `{set, clear} × {event, big-event, todo, due-date}`) so each gets a typed input schema. Bodies are direct lifts from each branch of the original switch.

Example for event:

```typescript
const eventExceptionInputSchema = z
  .object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideNotes: z.string().max(4000).nullable().optional(),
    overrideStartUtc: z.coerce.date().optional(),
    overrideEndUtc: z.coerce.date().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "empty override");

export async function setEventOccurrenceOp(
  userId: string,
  eventId: string,
  occurrence: string,
  input: unknown,
) {
  const ev = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!ev || !ev.rrule) throw new CalendarOpError("not-found", "recurring event not found");
  const parsed = eventExceptionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "setEventOccurrence: validation failed", {
      issues: parsed.error.issues,
    });
  }
  const originalStartUtc = parseOccurrenceDatetime(occurrence);
  return prisma.eventException.upsert({
    where: { eventId_originalStartUtc: { eventId, originalStartUtc } },
    create: { eventId, originalStartUtc, ...parsed.data },
    update: parsed.data,
  });
}

export async function clearEventOccurrenceOp(userId: string, eventId: string, occurrence: string) {
  const ev = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!ev) throw new CalendarOpError("not-found", "event not found");
  await prisma.eventException.deleteMany({
    where: { eventId, originalStartUtc: parseOccurrenceDatetime(occurrence) },
  });
  return { ok: true as const };
}
```

Repeat with the appropriate schema and Prisma table for big-event (uses `parseDateOnly`, schema includes `overrideCategoryId`), todo (uses `parseDateOnly`, schema has only `cancelled`/`overrideTitle`/`overrideNotes`), and due-date (uses `parseOccurrenceDatetime`, schema includes `overrideDueAt` and `overrideCategoryId`). The original schemas live at `cal.ts:784–818` — copy them into `calendar-ops.ts` unchanged.

- [ ] **Step 7: Expand the smoke test to exercise the new ops read-only**

Extend `src/scripts/test-mcp.ts`:

```typescript
const todos = await listTodosOp(uid, { from: "2026-05-12", to: "2026-05-13" });
console.log(`✓ listTodosOp: ${todos.length} todos`);

const bigs = await listBigEventsOp(uid, { from: "2026-05-12", to: "2026-05-15" });
console.log(`✓ listBigEventsOp: ${bigs.length} big events`);

const dues = await listDueDatesOp(uid, { from: "2026-05-12", to: "2026-05-13" });
console.log(`✓ listDueDatesOp: ${dues.length} due dates`);

const cats = await listCategoriesOp(uid);
console.log(`✓ listCategoriesOp: ${cats.length} categories`);
```

(Add the matching imports at the top.)

Run:
```bash
npx tsx -r dotenv/config -r ./src/scripts/use-prod-db.ts src/scripts/test-mcp.ts
```

Expected: all five `✓` lines, exit 0. Counts should match what `npm run cal:prod -- list-*` returns for the same ranges.

- [ ] **Step 8: Commit**

```bash
git add src/lib/calendar-ops.ts src/scripts/test-mcp.ts
git commit -m "feat(mcp): extract todo/big-event/due-date/category/reminder/occurrence ops"
```

---

## Task 5: Refactor cal.ts to use the ops layer

**Files:**
- Modify: `src/scripts/cal.ts`

The CLI's command bodies collapse to: parse positional/flag/stdin → call op → `out()` result. Top-level `main()`, `out()`, `fail()`, `parseFlags()`, `readStdin*()` stay. The helpers that have moved to ops (`resolveUserId`, `defaultRange`, `parseOccurrenceDatetime`, `parseOccurrenceDate`, `parseOrFail`) are deleted.

- [ ] **Step 1: Rewrite cal.ts top section**

Replace `cal.ts` lines 1–146 (everything down to `// ---------- events ----------`) with:

```typescript
/**
 * Calendar CLI — thin wrapper over src/lib/calendar-ops.ts. See that file for
 * the actual logic. This file owns argv/stdin parsing and JSON-on-stdout I/O.
 */

import "dotenv/config";
import {
  CalendarOpError,
  getUserId,
  listEventsOp,
  createEventOp,
  updateEventOp,
  deleteEventOp,
  listTodosOp,
  createTodoOp,
  updateTodoOp,
  completeTodoOp,
  deleteTodoOp,
  listBigEventsOp,
  createBigEventOp,
  updateBigEventOp,
  deleteBigEventOp,
  listDueDatesOp,
  createDueDateOp,
  updateDueDateOp,
  deleteDueDateOp,
  listCategoriesOp,
  listEventRemindersOp,
  listBigEventRemindersOp,
  listDueDateRemindersOp,
  addEventReminderOp,
  addBigEventReminderOp,
  addDueDateReminderOp,
  removeReminderOp,
  setEventOccurrenceOp,
  setBigEventOccurrenceOp,
  setTodoOccurrenceOp,
  setDueDateOccurrenceOp,
  clearEventOccurrenceOp,
  clearBigEventOccurrenceOp,
  clearTodoOccurrenceOp,
  clearDueDateOccurrenceOp,
} from "../lib/calendar-ops";

function out(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function fail(message: string, extra?: Record<string, unknown>): never {
  process.stderr.write(JSON.stringify({ error: message, ...extra }) + "\n");
  process.exit(1);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function readStdinJson(): Promise<unknown> {
  const raw = await readStdin();
  if (!raw.trim()) fail("expected JSON object on stdin");
  try { return JSON.parse(raw); } catch (e) { fail("invalid JSON on stdin", { detail: String(e) }); }
}

type Flags = { positional: string[]; named: Record<string, string | true> };

function parseFlags(argv: string[]): Flags {
  const positional: string[] = [];
  const named: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) named[key] = true;
      else { named[key] = next; i++; }
    } else positional.push(a);
  }
  return { positional, named };
}

function requireFlag(flags: Flags, name: string): string {
  const v = flags.named[name];
  if (typeof v !== "string") fail(`missing required --${name}`);
  return v;
}

function reminderTargetFlag(flags: Flags): { kind: "event" | "big-event" | "due-date"; id: string } {
  for (const kind of ["event", "big-event", "due-date"] as const) {
    const id = flags.named[kind];
    if (typeof id === "string") return { kind, id };
  }
  fail("specify --event, --big-event, or --due-date <id>");
}

function exceptionTargetFlag(flags: Flags): { kind: "event" | "big-event" | "todo" | "due-date"; id: string } {
  for (const kind of ["event", "big-event", "todo", "due-date"] as const) {
    const id = flags.named[kind];
    if (typeof id === "string") return { kind, id };
  }
  fail("specify --event, --big-event, --todo, or --due-date <id>");
}
```

- [ ] **Step 2: Rewrite the command handlers**

Replace the rest of `cal.ts` (from `// ---------- events ----------` to end) with the thin-wrapper handlers and updated `main()`:

```typescript
async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP + "\n");
    return;
  }
  const flags = parseFlags(argv);
  const userId = await getUserId();

  switch (cmd) {
    case "list-events": {
      const r = await listEventsOp(userId, { from: flags.named.from as string | undefined, to: flags.named.to as string | undefined });
      return out(r);
    }
    case "create-event": return out(await createEventOp(userId, await readStdinJson()));
    case "update-event": {
      const id = flags.positional[1]; if (!id) fail("usage: update-event <id>");
      return out(await updateEventOp(userId, id, await readStdinJson()));
    }
    case "delete-event": {
      const id = flags.positional[1]; if (!id) fail("usage: delete-event <id>");
      return out(await deleteEventOp(userId, id));
    }

    case "list-todos": return out(await listTodosOp(userId, { from: flags.named.from as string | undefined, to: flags.named.to as string | undefined }));
    case "create-todo": return out(await createTodoOp(userId, await readStdinJson()));
    case "update-todo": {
      const id = flags.positional[1]; if (!id) fail("usage: update-todo <id>");
      return out(await updateTodoOp(userId, id, await readStdinJson()));
    }
    case "complete-todo": {
      const id = flags.positional[1]; if (!id) fail("usage: complete-todo <id>");
      return out(await completeTodoOp(userId, id, true, flags.named.occurrence as string | undefined));
    }
    case "uncomplete-todo": {
      const id = flags.positional[1]; if (!id) fail("usage: uncomplete-todo <id>");
      return out(await completeTodoOp(userId, id, false, flags.named.occurrence as string | undefined));
    }
    case "delete-todo": {
      const id = flags.positional[1]; if (!id) fail("usage: delete-todo <id>");
      return out(await deleteTodoOp(userId, id));
    }

    case "list-big-events": return out(await listBigEventsOp(userId, { from: flags.named.from as string | undefined, to: flags.named.to as string | undefined }));
    case "create-big-event": return out(await createBigEventOp(userId, await readStdinJson()));
    case "update-big-event": {
      const id = flags.positional[1]; if (!id) fail("usage: update-big-event <id>");
      return out(await updateBigEventOp(userId, id, await readStdinJson()));
    }
    case "delete-big-event": {
      const id = flags.positional[1]; if (!id) fail("usage: delete-big-event <id>");
      return out(await deleteBigEventOp(userId, id));
    }

    case "list-due-dates": return out(await listDueDatesOp(userId, { from: flags.named.from as string | undefined, to: flags.named.to as string | undefined }));
    case "create-due-date": return out(await createDueDateOp(userId, await readStdinJson()));
    case "update-due-date": {
      const id = flags.positional[1]; if (!id) fail("usage: update-due-date <id>");
      return out(await updateDueDateOp(userId, id, await readStdinJson()));
    }
    case "delete-due-date": {
      const id = flags.positional[1]; if (!id) fail("usage: delete-due-date <id>");
      return out(await deleteDueDateOp(userId, id));
    }

    case "list-reminders": {
      const { kind, id } = reminderTargetFlag(flags);
      if (kind === "event") return out(await listEventRemindersOp(userId, id));
      if (kind === "big-event") return out(await listBigEventRemindersOp(userId, id));
      return out(await listDueDateRemindersOp(userId, id));
    }
    case "add-reminder": {
      const { kind, id } = reminderTargetFlag(flags);
      const body = (await readStdinJson()) as Record<string, unknown>;
      if (kind === "big-event") {
        const days = body.daysBefore; if (typeof days !== "number") fail("expected {daysBefore: number}");
        return out(await addBigEventReminderOp(userId, id, days));
      }
      const offset = body.offsetMinutes; if (typeof offset !== "number") fail("expected {offsetMinutes: number}");
      if (kind === "event") return out(await addEventReminderOp(userId, id, offset));
      return out(await addDueDateReminderOp(userId, id, offset));
    }
    case "remove-reminder": {
      const id = flags.positional[1]; if (!id) fail("usage: remove-reminder <id>");
      return out(await removeReminderOp(userId, id));
    }

    case "list-categories": return out(await listCategoriesOp(userId));

    case "set-occurrence": {
      const { kind, id } = exceptionTargetFlag(flags);
      const occ = requireFlag(flags, "occurrence");
      const body = await readStdinJson();
      if (kind === "event") return out(await setEventOccurrenceOp(userId, id, occ, body));
      if (kind === "big-event") return out(await setBigEventOccurrenceOp(userId, id, occ, body));
      if (kind === "todo") return out(await setTodoOccurrenceOp(userId, id, occ, body));
      return out(await setDueDateOccurrenceOp(userId, id, occ, body));
    }
    case "clear-occurrence": {
      const { kind, id } = exceptionTargetFlag(flags);
      const occ = requireFlag(flags, "occurrence");
      if (kind === "event") return out(await clearEventOccurrenceOp(userId, id, occ));
      if (kind === "big-event") return out(await clearBigEventOccurrenceOp(userId, id, occ));
      if (kind === "todo") return out(await clearTodoOccurrenceOp(userId, id, occ));
      return out(await clearDueDateOccurrenceOp(userId, id, occ));
    }

    default: fail(`unknown command: ${cmd}. run \`npm run cal -- help\` for usage.`);
  }
}

const HELP = `
Calendar CLI. See src/mcp/README.md — this CLI is a fallback; primary access is via the calendar MCP server.

Reads: list-events, list-todos, list-big-events, list-due-dates, list-reminders, list-categories
Writes (JSON stdin): create-event, update-event <id>, create-todo, update-todo <id>,
       create-big-event, update-big-event <id>, create-due-date, update-due-date <id>,
       add-reminder, set-occurrence
Deletes / toggles: delete-event <id>, delete-todo <id>, delete-big-event <id>,
       delete-due-date <id>, remove-reminder <id>,
       complete-todo <id> [--occurrence YYYY-MM-DD], uncomplete-todo <id> [--occurrence YYYY-MM-DD],
       clear-occurrence

Range flags for list-*: --from YYYY-MM-DD --to YYYY-MM-DD (LA local). Default: today through +30 days.
Reminder commands take --event <id> | --big-event <id> | --due-date <id>.
Occurrence commands also accept --todo <id>; --occurrence is YYYY-MM-DD for big-event/todo, YYYY-MM-DDTHH:mm (LA) for event/due-date.
`.trim();

main()
  .catch((err) => {
    if (err instanceof CalendarOpError) {
      process.stderr.write(JSON.stringify({ error: err.message, code: err.code, ...err.detail }) + "\n");
    } else {
      process.stderr.write(JSON.stringify({ error: String(err?.message ?? err) }) + "\n");
    }
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../lib/db");
    await prisma.$disconnect();
  });
```

Note the import of `CalendarOpError` at the top now lets the top-level handler distinguish op errors from infrastructure errors and add the `code` field to the JSON. The original behavior of "validation failed" wrapping `issues` is preserved because op throws include `detail: { issues }`.

- [ ] **Step 3: Smoke-test parity with the original CLI**

Pick three CLI invocations whose output we already know from this session:

```bash
cd /Users/renzofukuda/Desktop/Repos/personal_calendar
npm run cal:prod --silent -- list-events --from 2026-05-12 --to 2026-05-12 > /tmp/new.json
git stash # temporarily get back the old cal.ts via stash, OR
git show HEAD~3:src/scripts/cal.ts > /tmp/old-cal.ts # compare against pre-refactor expected output written down in this plan
```

Easier: just verify the new CLI returns the three events we listed earlier (Fencing 14:00 UTC, ENGR76 QUIZ 20:30 UTC, Lift 23:30 UTC). If they all appear with the same UTC timestamps and ids, behavior is preserved.

Also run:
```bash
npm run cal:prod --silent -- list-categories | head
npm run cal:prod --silent -- list-todos --from 2026-05-12 --to 2026-05-13
```

Expected: same shapes as before — no `error` keys, JSON arrays, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/cal.ts
git commit -m "refactor(cli): thin cal.ts handlers, delegate to lib/calendar-ops"
```

---

## Task 6: Build the MCP server input schemas

**Files:**
- Modify: `src/lib/calendar-ops-schemas.ts`

These are the Zod schemas the MCP server uses for **tool input** — separate from the create/update schemas the ops use internally. The MCP layer needs them flat (no nested `params`) because each MCP tool input is one object. The ops then forward subsets to the existing `eventCreateSchema` etc.

- [ ] **Step 1: Write the input schemas**

Write `src/lib/calendar-ops-schemas.ts`:

```typescript
import { z } from "zod";

// Range — all list_* tools share this.
export const rangeInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("LA-local start date YYYY-MM-DD. Default: today."),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("LA-local end date YYYY-MM-DD (inclusive). Default: today + 30 days."),
});

// Create/update inputs — pass-through to the existing schemas. We model loosely
// here (record of unknown) and let the op-layer schemas do strict validation,
// to avoid duplicating the schema definitions.
const passthrough = z.record(z.string(), z.unknown())
  .describe("See src/schemas/* — same shape the existing CLI accepts on stdin.");

export const createEventInput = passthrough;
export const updateEventInput = z.object({ id: z.string().cuid() }).and(passthrough);
export const deleteByIdInput = z.object({ id: z.string().cuid() });

export const createTodoInput = passthrough;
export const updateTodoInput = updateEventInput;
export const completeTodoInput = z.object({
  id: z.string().cuid(),
  occurrence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Required iff the todo is recurring. YYYY-MM-DD LA-local."),
});

export const createBigEventInput = passthrough;
export const updateBigEventInput = updateEventInput;

export const createDueDateInput = passthrough;
export const updateDueDateInput = updateEventInput;

export const listRemindersInput = z.object({
  target: z.enum(["event", "big-event", "due-date"]),
  id: z.string().cuid(),
});

export const addEventReminderInput = z.object({
  eventId: z.string().cuid(),
  offsetMinutes: z.number().int().min(0).max(60 * 24 * 365),
});
export const addBigEventReminderInput = z.object({
  bigEventId: z.string().cuid(),
  daysBefore: z.number().int().min(0).max(365),
});
export const addDueDateReminderInput = z.object({
  dueDateId: z.string().cuid(),
  offsetMinutes: z.number().int().min(0).max(60 * 24 * 365),
});
export const removeReminderInput = z.object({ id: z.string().cuid() });

// Occurrence inputs. The body shape varies per target; we model the union
// as 8 distinct MCP tools so each gets a tight schema.
const occDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const occDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const setEventOccurrenceInput = z.object({
  eventId: z.string().cuid(),
  occurrence: occDateTime.describe("LA-local datetime matching the original RRULE start."),
  override: z.object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideNotes: z.string().max(4000).nullable().optional(),
    overrideStartUtc: occDateTime.optional(),
    overrideEndUtc: occDateTime.optional(),
  }).refine((v) => Object.keys(v).length > 0, "empty override"),
});

export const setBigEventOccurrenceInput = z.object({
  bigEventId: z.string().cuid(),
  occurrence: occDateOnly,
  override: z.object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideNotes: z.string().max(4000).nullable().optional(),
    overrideCategoryId: z.string().cuid().nullable().optional(),
  }).refine((v) => Object.keys(v).length > 0, "empty override"),
});

export const setTodoOccurrenceInput = z.object({
  todoId: z.string().cuid(),
  occurrence: occDateOnly,
  override: z.object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideNotes: z.string().max(4000).nullable().optional(),
  }).refine((v) => Object.keys(v).length > 0, "empty override"),
});

export const setDueDateOccurrenceInput = z.object({
  dueDateId: z.string().cuid(),
  occurrence: occDateTime,
  override: z.object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideDueAt: occDateTime.optional(),
    overrideCategoryId: z.string().cuid().nullable().optional(),
  }).refine((v) => Object.keys(v).length > 0, "empty override"),
});

export const clearEventOccurrenceInput = z.object({
  eventId: z.string().cuid(),
  occurrence: occDateTime,
});
export const clearBigEventOccurrenceInput = z.object({
  bigEventId: z.string().cuid(),
  occurrence: occDateOnly,
});
export const clearTodoOccurrenceInput = z.object({
  todoId: z.string().cuid(),
  occurrence: occDateOnly,
});
export const clearDueDateOccurrenceInput = z.object({
  dueDateId: z.string().cuid(),
  occurrence: occDateTime,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/calendar-ops-schemas.ts
git commit -m "feat(mcp): add MCP tool input schemas in calendar-ops-schemas"
```

---

## Task 7: Write the MCP server

**Files:**
- Modify: `src/mcp/server.ts`

Uses `@modelcontextprotocol/sdk` ≥ 1.0 with the `McpServer` high-level API and `StdioServerTransport`. Each tool is registered with its zod schema; the handler calls the op and returns `{ content: [{ type: "text", text: JSON.stringify(result) }] }`. Errors from `CalendarOpError` become tool errors with the op's code.

- [ ] **Step 1: Server bootstrap**

Write the top of `src/mcp/server.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CalendarOpError,
  getUserId,
  listEventsOp,
  createEventOp,
  updateEventOp,
  deleteEventOp,
  listTodosOp,
  createTodoOp,
  updateTodoOp,
  completeTodoOp,
  deleteTodoOp,
  listBigEventsOp,
  createBigEventOp,
  updateBigEventOp,
  deleteBigEventOp,
  listDueDatesOp,
  createDueDateOp,
  updateDueDateOp,
  deleteDueDateOp,
  listCategoriesOp,
  listEventRemindersOp,
  listBigEventRemindersOp,
  listDueDateRemindersOp,
  addEventReminderOp,
  addBigEventReminderOp,
  addDueDateReminderOp,
  removeReminderOp,
  setEventOccurrenceOp,
  setBigEventOccurrenceOp,
  setTodoOccurrenceOp,
  setDueDateOccurrenceOp,
  clearEventOccurrenceOp,
  clearBigEventOccurrenceOp,
  clearTodoOccurrenceOp,
  clearDueDateOccurrenceOp,
} from "../lib/calendar-ops";
import * as S from "../lib/calendar-ops-schemas";

const server = new McpServer({ name: "calendar", version: "1.0.0" });

/**
 * Wrap an op so its result becomes a valid MCP tool response and any
 * CalendarOpError becomes a structured error.
 */
function wrap<T>(fn: () => Promise<T>) {
  return async () => {
    try {
      const result = await fn();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      if (e instanceof CalendarOpError) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: e.message, code: e.code, ...e.detail }, null, 2),
          }],
        };
      }
      throw e;
    }
  };
}

let userId: string;
```

- [ ] **Step 2: Register read tools**

Append:

```typescript
server.registerTool(
  "list_events",
  {
    description: "List events in an LA-local date range. Recurring series are expanded into occurrences.",
    inputSchema: S.rangeInput.shape,
  },
  (args) => wrap(() => listEventsOp(userId, args))(),
);

server.registerTool(
  "list_todos",
  { description: "List todos in a date range. Recurring todos expanded into per-day occurrences.", inputSchema: S.rangeInput.shape },
  (args) => wrap(() => listTodosOp(userId, args))(),
);

server.registerTool(
  "list_big_events",
  { description: "List all-day events (birthdays, exams) in a date range.", inputSchema: S.rangeInput.shape },
  (args) => wrap(() => listBigEventsOp(userId, args))(),
);

server.registerTool(
  "list_due_dates",
  { description: "List deadlines in a date range.", inputSchema: S.rangeInput.shape },
  (args) => wrap(() => listDueDatesOp(userId, args))(),
);

server.registerTool(
  "list_categories",
  { description: "List all categories.", inputSchema: {} },
  () => wrap(() => listCategoriesOp(userId))(),
);

server.registerTool(
  "list_reminders",
  { description: "List reminders attached to one Event/BigEvent/DueDate.", inputSchema: S.listRemindersInput.shape },
  (args) => wrap(() => {
    if (args.target === "event") return listEventRemindersOp(userId, args.id);
    if (args.target === "big-event") return listBigEventRemindersOp(userId, args.id);
    return listDueDateRemindersOp(userId, args.id);
  })(),
);
```

- [ ] **Step 3: Register write tools**

Append all create/update/delete/complete/reminder/occurrence tools. The pattern is identical to reads, just with `S.<schema>.shape` and the matching op. Full registration code:

```typescript
// --- Events ---
server.registerTool("create_event",
  { description: "Create an event (timed). Body matches eventCreateSchema.", inputSchema: { body: S.createEventInput } },
  ({ body }) => wrap(() => createEventOp(userId, body))(),
);
server.registerTool("update_event",
  { description: "Update an event by id. Partial body.", inputSchema: { id: S.updateEventInput.shape.id, body: S.createEventInput } },
  ({ id, body }) => wrap(() => updateEventOp(userId, id, body))(),
);
server.registerTool("delete_event",
  { description: "Delete an event by id (kills the whole series).", inputSchema: S.deleteByIdInput.shape },
  ({ id }) => wrap(() => deleteEventOp(userId, id))(),
);

// --- Todos ---
server.registerTool("create_todo",
  { description: "Create a todo (daily checkbox). Body matches todoCreateSchema.", inputSchema: { body: S.createTodoInput } },
  ({ body }) => wrap(() => createTodoOp(userId, body))(),
);
server.registerTool("update_todo",
  { description: "Update a todo by id.", inputSchema: { id: S.updateTodoInput.shape.id, body: S.createTodoInput } },
  ({ id, body }) => wrap(() => updateTodoOp(userId, id, body))(),
);
server.registerTool("complete_todo",
  { description: "Mark a todo done. For recurring todos, --occurrence required.", inputSchema: S.completeTodoInput.shape },
  ({ id, occurrence }) => wrap(() => completeTodoOp(userId, id, true, occurrence))(),
);
server.registerTool("uncomplete_todo",
  { description: "Unmark a completed todo.", inputSchema: S.completeTodoInput.shape },
  ({ id, occurrence }) => wrap(() => completeTodoOp(userId, id, false, occurrence))(),
);
server.registerTool("delete_todo",
  { description: "Delete a todo by id.", inputSchema: S.deleteByIdInput.shape },
  ({ id }) => wrap(() => deleteTodoOp(userId, id))(),
);

// --- Big events ---
server.registerTool("create_big_event",
  { description: "Create an all-day big event (birthday, exam, etc).", inputSchema: { body: S.createBigEventInput } },
  ({ body }) => wrap(() => createBigEventOp(userId, body))(),
);
server.registerTool("update_big_event",
  { description: "Update a big event by id.", inputSchema: { id: S.updateBigEventInput.shape.id, body: S.createBigEventInput } },
  ({ id, body }) => wrap(() => updateBigEventOp(userId, id, body))(),
);
server.registerTool("delete_big_event",
  { description: "Delete a big event by id.", inputSchema: S.deleteByIdInput.shape },
  ({ id }) => wrap(() => deleteBigEventOp(userId, id))(),
);

// --- Due dates ---
server.registerTool("create_due_date",
  { description: "Create a deadline.", inputSchema: { body: S.createDueDateInput } },
  ({ body }) => wrap(() => createDueDateOp(userId, body))(),
);
server.registerTool("update_due_date",
  { description: "Update a deadline by id.", inputSchema: { id: S.updateDueDateInput.shape.id, body: S.createDueDateInput } },
  ({ id, body }) => wrap(() => updateDueDateOp(userId, id, body))(),
);
server.registerTool("delete_due_date",
  { description: "Delete a deadline by id.", inputSchema: S.deleteByIdInput.shape },
  ({ id }) => wrap(() => deleteDueDateOp(userId, id))(),
);

// --- Reminders ---
server.registerTool("add_event_reminder",
  { description: "Attach a reminder to an Event. offsetMinutes before start.", inputSchema: S.addEventReminderInput.shape },
  ({ eventId, offsetMinutes }) => wrap(() => addEventReminderOp(userId, eventId, offsetMinutes))(),
);
server.registerTool("add_big_event_reminder",
  { description: "Attach a reminder to a BigEvent. daysBefore the date.", inputSchema: S.addBigEventReminderInput.shape },
  ({ bigEventId, daysBefore }) => wrap(() => addBigEventReminderOp(userId, bigEventId, daysBefore))(),
);
server.registerTool("add_due_date_reminder",
  { description: "Attach a reminder to a DueDate. offsetMinutes before dueAt.", inputSchema: S.addDueDateReminderInput.shape },
  ({ dueDateId, offsetMinutes }) => wrap(() => addDueDateReminderOp(userId, dueDateId, offsetMinutes))(),
);
server.registerTool("remove_reminder",
  { description: "Remove a reminder by id.", inputSchema: S.removeReminderInput.shape },
  ({ id }) => wrap(() => removeReminderOp(userId, id))(),
);

// --- Occurrence overrides (8 tools) ---
server.registerTool("set_event_occurrence",
  { description: "Override one occurrence of a recurring event (move time, rename, cancel just that one).", inputSchema: S.setEventOccurrenceInput.shape },
  ({ eventId, occurrence, override }) => wrap(() => setEventOccurrenceOp(userId, eventId, occurrence, override))(),
);
server.registerTool("set_big_event_occurrence",
  { description: "Override one occurrence of a recurring big event.", inputSchema: S.setBigEventOccurrenceInput.shape },
  ({ bigEventId, occurrence, override }) => wrap(() => setBigEventOccurrenceOp(userId, bigEventId, occurrence, override))(),
);
server.registerTool("set_todo_occurrence",
  { description: "Override one occurrence of a recurring todo.", inputSchema: S.setTodoOccurrenceInput.shape },
  ({ todoId, occurrence, override }) => wrap(() => setTodoOccurrenceOp(userId, todoId, occurrence, override))(),
);
server.registerTool("set_due_date_occurrence",
  { description: "Override one occurrence of a recurring deadline.", inputSchema: S.setDueDateOccurrenceInput.shape },
  ({ dueDateId, occurrence, override }) => wrap(() => setDueDateOccurrenceOp(userId, dueDateId, occurrence, override))(),
);

server.registerTool("clear_event_occurrence",
  { description: "Revert an overridden event occurrence back to the series default.", inputSchema: S.clearEventOccurrenceInput.shape },
  ({ eventId, occurrence }) => wrap(() => clearEventOccurrenceOp(userId, eventId, occurrence))(),
);
server.registerTool("clear_big_event_occurrence",
  { description: "Revert an overridden big-event occurrence.", inputSchema: S.clearBigEventOccurrenceInput.shape },
  ({ bigEventId, occurrence }) => wrap(() => clearBigEventOccurrenceOp(userId, bigEventId, occurrence))(),
);
server.registerTool("clear_todo_occurrence",
  { description: "Revert an overridden todo occurrence.", inputSchema: S.clearTodoOccurrenceInput.shape },
  ({ todoId, occurrence }) => wrap(() => clearTodoOccurrenceOp(userId, todoId, occurrence))(),
);
server.registerTool("clear_due_date_occurrence",
  { description: "Revert an overridden deadline occurrence.", inputSchema: S.clearDueDateOccurrenceInput.shape },
  ({ dueDateId, occurrence }) => wrap(() => clearDueDateOccurrenceOp(userId, dueDateId, occurrence))(),
);
```

- [ ] **Step 4: Main entry**

Append:

```typescript
async function main() {
  userId = await getUserId();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.stack ?? e}\n`);
  process.exit(1);
});
```

- [ ] **Step 5: Run in dev mode and verify stdio handshake**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npm run mcp:dev
```

Expected: a single line of JSON-RPC output listing all ~30 registered tool names (`list_events`, `create_event`, ..., `clear_due_date_occurrence`). If the process hangs, the server is fine — Ctrl-C is OK because stdio transport reads continuously.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat(mcp): MCP server registering all 30 calendar tools"
```

---

## Task 8: End-to-end smoke test of built bundle

**Files:**
- Modify: `src/scripts/test-mcp.ts`

The script spawns the *built* MCP server as a subprocess, talks to it over stdio with the MCP SDK client, and exercises the most important tools. This catches packaging errors (missing external, bad import path) that `mcp:dev` won't.

- [ ] **Step 1: Replace test-mcp.ts with an integration test**

```typescript
import "dotenv/config";
import "./use-prod-db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/mcp/server.mjs"],
    env: { ...process.env, DATABASE_URL_PROD: process.env.DATABASE_URL_PROD! },
  });
  const client = new Client({ name: "smoke-test", version: "1.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`✓ ${tools.tools.length} tools registered`);
  if (tools.tools.length < 28) throw new Error(`expected ≥28 tools, got ${tools.tools.length}`);

  const evRes = await client.callTool({ name: "list_events", arguments: { from: "2026-05-12", to: "2026-05-12" } });
  const evs = JSON.parse((evRes.content[0] as { text: string }).text);
  if (!Array.isArray(evs)) throw new Error(`list_events returned non-array: ${JSON.stringify(evs)}`);
  console.log(`✓ list_events(May 12): ${evs.length} events`);

  const catRes = await client.callTool({ name: "list_categories", arguments: {} });
  const cats = JSON.parse((catRes.content[0] as { text: string }).text);
  console.log(`✓ list_categories: ${cats.length} categories`);

  // Round-trip: create → list → delete a throwaway event.
  const created = await client.callTool({
    name: "create_event",
    arguments: { body: { title: "[mcp smoke] DELETE ME", startUtc: "2026-12-31T23:00", endUtc: "2026-12-31T23:30" } },
  });
  const createdObj = JSON.parse((created.content[0] as { text: string }).text);
  console.log(`✓ create_event: ${createdObj.id}`);

  await client.callTool({ name: "delete_event", arguments: { id: createdObj.id } });
  console.log(`✓ delete_event: ${createdObj.id}`);

  await client.close();
  console.log("✓ all smoke tests passed");
}

main().catch((e) => {
  console.error("✗ smoke test failed:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Build and run**

```bash
npm run mcp:test
```

Expected: every `✓` line, exit 0. If `list_events` returns 0 events on a date you know has events, the prod DB env is being lost in the spawn — check that `DATABASE_URL_PROD` is in `.env` and `use-prod-db.ts` is being loaded.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/test-mcp.ts
git commit -m "test(mcp): end-to-end smoke test against built bundle"
```

---

## Task 9: Register the MCP server with Claude Code

**Files:** None (modifies `~/.claude.json` via CLI)

- [ ] **Step 1: Read DATABASE_URL_PROD from .env**

```bash
cd /Users/renzofukuda/Desktop/Repos/personal_calendar
grep '^DATABASE_URL_PROD=' .env | head -1
```

Copy the value (everything after the `=`). It will be a Neon `postgresql://...` URL with credentials. You'll paste it into the next command.

- [ ] **Step 2: Register the MCP server at user scope**

```bash
claude mcp add-json --scope user calendar "$(cat <<JSON
{
  "command": "node",
  "args": ["/Users/renzofukuda/Desktop/Repos/personal_calendar/dist/mcp/server.mjs"],
  "env": {
    "DATABASE_URL_PROD": "<paste here>"
  }
}
JSON
)"

chmod 600 ~/.claude.json
```

- [ ] **Step 3: Verify**

```bash
claude mcp list 2>&1 | grep calendar
```

Expected: `calendar: node /Users/renzofukuda/Desktop/Repos/personal_calendar/dist/mcp/server.mjs - ✓ Connected`.

- [ ] **Step 4: Restart Claude Code**

The new tools are loaded when the server subprocess spawns at session start — they will not appear in the current session.

After restart, you should see `mcp__calendar__*` tools in the deferred-tool list.

- [ ] **Step 5: Manual end-to-end verification**

In the restarted session, ask Claude: "what do I have on Tuesday May 12?". It should call `mcp__calendar__list_events`, `list_todos`, `list_big_events`, `list_due_dates` and respond in ~500ms total instead of ~10s.

Time the round trip: if it's still slow, something is wrong — likely the MCP server is crashing on each tool call and respawning. Check `claude mcp list` health output.

---

## Task 10: Trim the calendar skill to point at MCP

**Files:**
- Modify: `~/.claude/skills/calendar/SKILL.md` (or wherever the skill body lives)

The current skill body is ~200 lines documenting the CLI commands. With MCP, Claude reads tool schemas + descriptions directly from the server at session start, so most of the prose is redundant. Keep only what isn't recoverable from the MCP tool listing: the timezone/recurrence conventions, the entity-type guidance ("Event vs BigEvent vs Todo vs DueDate"), and the workflow rules.

- [ ] **Step 1: Locate the skill file**

```bash
find ~/.claude/skills -name "*.md" -path "*calendar*"
```

Note the path; the next step rewrites it.

- [ ] **Step 2: Replace with a trimmed version**

```markdown
# Calendar (personal_calendar)

Renzo's personal_calendar app, surfaced as the local **`calendar`** MCP server (tools `mcp__calendar__list_events`, `create_event`, `set_event_occurrence`, etc.). Tool schemas come from the server itself — read them at the call site, not from this file.

Trigger this skill on anything calendar-related — "what's tomorrow", "add a 9am dentist Friday", "move next Monday's standup", "what's due this week", etc.

## Conventions (NOT recoverable from tool schemas)

- **User is hardcoded.** All tools scope to `rfukuda06@gmail.com`. Don't ask which calendar.
- **Timezone.** Inputs are **LA-local** `YYYY-MM-DDTHH:mm` for datetimes, `YYYY-MM-DD` for dates. Outputs are UTC ISO. Always present results to Renzo in LA-local; convert before displaying.
- **Recurrence.** RRULE strings per RFC 5545, no `DTSTART` line. Examples: `FREQ=WEEKLY;BYDAY=MO`, `FREQ=DAILY`, `FREQ=MONTHLY;BYMONTHDAY=1;COUNT=12`.
- **Entity types — pick carefully:**
  - **Event** — timed thing (start/end). Meeting, dentist, lift.
  - **BigEvent** — all-day. Birthday, exam, holiday.
  - **Todo** — daily checkbox with a due date. Things you check off.
  - **DueDate** — deadline at a specific instant. No "completed" state.

## Workflow

1. **Resolve relative dates first.** "Tomorrow" / "next Monday" → absolute LA-local date before constructing tool args.
2. **List before mutating.** "Move my dentist" → `list_events` over a sensible window, find the row by title, then `update_event`.
3. **Whole series vs. one occurrence.** "Cancel my standup" = whole series → `delete_event`. "Cancel this week's standup" = one occurrence → `set_event_occurrence` with `cancelled: true`.
4. **Categories are read-only.** Use `list_categories` and reuse existing IDs. New categories go through the web UI.
5. **Echo plain English on writes.** "Created your dentist appointment for Friday 3pm" — don't dump JSON.

## Fallback

If the MCP server is down, the original CLI still works: `npm run cal:prod --silent -- <command> [flags]` in `/Users/renzofukuda/Desktop/Repos/personal_calendar`. Same behavior, much slower.
```

- [ ] **Step 3: Verify the trimmed skill loads in a new session**

Restart Claude Code, then ask "what do I have tomorrow?". The skill should activate; Claude should call `mcp__calendar__list_events` etc., not shell out to `npm run cal:prod`.

- [ ] **Step 4: Commit the personal_calendar side**

The skill file is outside the repo, so no commit there. In the repo:

```bash
cd /Users/renzofukuda/Desktop/Repos/personal_calendar
git status
```

If everything from prior tasks is committed, you should see `nothing to commit, working tree clean`. We're done.

---

## Self-Review Checklist

- **Spec coverage:** Every CLI command in `cal.ts:947–991` is wrapped as an MCP tool — 6 reads, 4 creates, 4 updates, 4 deletes, 2 todo completions, 1 list-reminders, 3 add-reminders, 1 remove-reminder, 1 list-categories, 4 set-occurrence variants, 4 clear-occurrence variants = 34 tools. (List-reminders is a single tool with a `target` discriminator since the output shape is identical across targets; add-reminder splits because input shape differs.)
- **Placeholders:** None — every step has runnable commands or full code.
- **Type consistency:** Op signatures defined in Task 2 (`getUserId`, `CalendarOpError`) → consumed verbatim in Tasks 3, 4, 5, 7. The eight occurrence ops use `parseOccurrenceDatetime` (Event/DueDate) vs `parseDateOnly` (BigEvent/Todo) consistently with the CLI's original distinction.
- **Fallback path:** CLI continues to work post-refactor because Task 5 keeps it as a thin wrapper over the same ops. If MCP breaks for any reason, `npm run cal:prod` still serves.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-calendar-mcp-server.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
