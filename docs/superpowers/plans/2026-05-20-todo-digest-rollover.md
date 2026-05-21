# Todo Digest Rollover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the noon-LA todo digest email include incomplete todos that have rolled forward from earlier days, grouped under a separate "Rolled over" heading with each item's original date.

**Architecture:** Extract the rollover-aware query (currently inlined in `GET /api/todos`) into a shared `src/lib/todos.ts` so both the API and the digest run the same code. Add a small `partitionForDigest` helper alongside it so the dry-run script and the digest agree on how to split "today" vs "rolled over."

**Tech Stack:** TypeScript, Next.js 16 App Router, Prisma, Luxon, `@react-email/components`, Resend, `rrule`. No test framework — verification is a one-off parity check script (TDD-style red/green) plus a manual dry-run.

**Spec:** `docs/superpowers/specs/2026-05-20-todo-digest-rollover-design.md`

---

## File Structure

- **Create** `src/lib/todos.ts` — exports `ROLLOVER_DAYS`, `ResolvedTodo`, `DigestTodos`, `resolveTodosForDay(userId, date)`, `partitionForDigest(items, date)`. One responsibility: the rollover-aware todo query and the digest partition rule.
- **Create** `src/scripts/test-resolve-todos.ts` — parity check: runs the legacy inline query (frozen snapshot) and `resolveTodosForDay` against the prod-mirror DB and deep-equals their output. Deleted in the last task once the refactor lands.
- **Modify** `src/app/api/todos/route.ts` (lines 1–110) — `GET` calls `resolveTodosForDay`. Validation and the `POST` handler are untouched.
- **Modify** `src/lib/email.ts` (lines 66–83) — `TodoDigestEmailInput` and `sendTodoDigestEmail` adopt the `{ today, rolledOver }` shape; subject becomes `${today.length + rolledOver.length} todos`.
- **Modify** `src/emails/TodoDigestEmail.tsx` (all 31 lines) — two sections with conditional headings.
- **Modify** `src/scripts/send-reminders.ts` (`processTodoDigest`, lines 439–521) — call `resolveTodosForDay`, then `partitionForDigest`, then send.

---

## Task 1: Write parity test, then create the resolver helper (TDD red → green)

**Files:**
- Create: `src/scripts/test-resolve-todos.ts`
- Create: `src/lib/todos.ts`

- [ ] **Step 1.1: Write the failing parity test**

Create `src/scripts/test-resolve-todos.ts`:

```ts
import "dotenv/config";
import "./use-prod-db";
import { prisma } from "../lib/db";
import { resolveTodosForDay } from "../lib/todos";
import { expandOccurrences, occurrenceId } from "../lib/recurrence";
import { laTodayISO } from "../lib/time";

// Frozen snapshot of the GET /api/todos rollover query as it stood
// before extraction. Used purely as an oracle for the parity check
// in this script — deleted alongside this script in the cleanup task.
const ROLLOVER_DAYS = 90;
async function legacyResolve(userId: string, date: Date) {
  const tomorrow = new Date(date.getTime() + 86400000);
  const windowStart = new Date(date.getTime() - ROLLOVER_DAYS * 86400000);
  const todayUtc = new Date(`${laTodayISO()}T00:00:00.000Z`);
  const rolloverCutoff = date < todayUtc ? date : todayUtc;

  type Wire = {
    id: string;
    seriesId: string;
    title: string;
    notes: string | null;
    dueDate: Date;
    completedAt: Date | null;
    rrule: string | null;
    isOccurrence: boolean;
    occurrenceDate: Date | null;
  };

  const singles = await prisma.todo.findMany({
    where: {
      userId,
      rrule: null,
      OR: [
        { dueDate: date },
        { dueDate: { lt: rolloverCutoff }, completedAt: null },
      ],
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });

  const series = await prisma.todo.findMany({
    where: { userId, rrule: { not: null } },
    include: {
      completions: {
        where: { occurrenceDate: { gte: windowStart, lt: tomorrow } },
      },
      exceptions: {
        where: { occurrenceDate: { gte: windowStart, lt: tomorrow } },
      },
    },
  });

  const expanded: Wire[] = [];
  for (const s of series) {
    if (!s.rrule) continue;
    const completedSet = new Set(
      s.completions.map((c) => c.occurrenceDate.getTime()),
    );
    const exByOccurrence = new Map(
      s.exceptions.map((e) => [e.occurrenceDate.getTime(), e]),
    );
    const expandFrom = s.dueDate > windowStart ? s.dueDate : windowStart;
    const occs = expandOccurrences(s.rrule, s.dueDate, expandFrom, tomorrow);
    for (const occ of occs) {
      const ex = exByOccurrence.get(occ.getTime());
      if (ex?.cancelled) continue;
      const isViewedDay = occ.getTime() === date.getTime();
      if (!isViewedDay) {
        if (occ.getTime() >= rolloverCutoff.getTime()) continue;
        if (completedSet.has(occ.getTime())) continue;
      }
      const completion = s.completions.find(
        (c) => c.occurrenceDate.getTime() === occ.getTime(),
      );
      expanded.push({
        id: occurrenceId(s.id, occ),
        seriesId: s.id,
        title: ex?.overrideTitle ?? s.title,
        notes: ex?.overrideNotes ?? s.notes,
        dueDate: occ,
        completedAt: completion?.completedAt ?? null,
        rrule: s.rrule,
        isOccurrence: true,
        occurrenceDate: occ,
      });
    }
  }

  const out: Wire[] = [
    ...singles.map((t) => ({
      id: t.id,
      seriesId: t.id,
      title: t.title,
      notes: t.notes,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      rrule: null,
      isOccurrence: false,
      occurrenceDate: null,
    })),
    ...expanded,
  ];
  out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return out;
}

async function main() {
  const users = await prisma.user.findMany({
    where: { notificationsEnabled: true },
    select: { id: true, email: true },
    take: 5,
  });
  if (users.length === 0) throw new Error("no users with notifications enabled");

  const today = new Date(`${laTodayISO()}T00:00:00.000Z`);
  const yesterday = new Date(today.getTime() - 86400000);
  const dates = [today, yesterday];

  for (const u of users) {
    for (const d of dates) {
      const [expected, actual] = await Promise.all([
        legacyResolve(u.id, d),
        resolveTodosForDay(u.id, d),
      ]);
      const e = JSON.stringify(expected);
      const a = JSON.stringify(actual);
      if (e !== a) {
        console.error(`✗ mismatch for ${u.email} on ${d.toISOString()}`);
        console.error("expected:", e);
        console.error("actual:  ", a);
        throw new Error("parity violation");
      }
      console.log(`✓ ${u.email} @ ${d.toISOString().slice(0, 10)}: ${actual.length} items`);
    }
  }
  await prisma.$disconnect();
  console.log("✓ all parity checks passed");
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect().finally(() => process.exit(1));
});
```

- [ ] **Step 1.2: Run the parity script to verify it fails**

Run:

```bash
tsx -r dotenv/config -r ./src/scripts/use-prod-db.ts src/scripts/test-resolve-todos.ts
```

Expected: fails with a TS / module-resolution error along the lines of `Cannot find module '../lib/todos'` because `src/lib/todos.ts` does not exist yet. This is the RED state.

- [ ] **Step 1.3: Implement `src/lib/todos.ts`**

Create `src/lib/todos.ts`:

```ts
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { expandOccurrences, occurrenceId } from "@/lib/recurrence";
import { laTodayISO } from "@/lib/time";

// Cap the rollover window for recurring todos so a daily-forever todo with
// thousands of historical occurrences doesn't all surface at once.
export const ROLLOVER_DAYS = 90;

export type ResolvedTodo = {
  id: string;
  seriesId: string;
  title: string;
  notes: string | null;
  dueDate: Date;
  completedAt: Date | null;
  rrule: string | null;
  isOccurrence: boolean;
  occurrenceDate: Date | null;
};

export type DigestTodos = {
  today: { title: string }[];
  rolledOver: { title: string; from: string }[];
};

/**
 * Returns the todo list visible on `date` (midnight UTC of an LA day):
 *  - todos dated exactly `date` (completed or not), and
 *  - incomplete todos from earlier days that have rolled forward.
 * Rollover only kicks in once the next day has actually arrived (LA-zone),
 * so a todo from today doesn't pre-emptively appear on tomorrow's list.
 */
export async function resolveTodosForDay(
  userId: string,
  date: Date,
): Promise<ResolvedTodo[]> {
  const tomorrow = new Date(date.getTime() + 86400000);
  const windowStart = new Date(date.getTime() - ROLLOVER_DAYS * 86400000);
  const todayUtc = new Date(`${laTodayISO()}T00:00:00.000Z`);
  const rolloverCutoff = date < todayUtc ? date : todayUtc;

  const singles = await prisma.todo.findMany({
    where: {
      userId,
      rrule: null,
      OR: [
        { dueDate: date },
        { dueDate: { lt: rolloverCutoff }, completedAt: null },
      ],
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });

  const series = await prisma.todo.findMany({
    where: { userId, rrule: { not: null } },
    include: {
      completions: {
        where: { occurrenceDate: { gte: windowStart, lt: tomorrow } },
      },
      exceptions: {
        where: { occurrenceDate: { gte: windowStart, lt: tomorrow } },
      },
    },
  });

  const expanded: ResolvedTodo[] = [];
  for (const s of series) {
    if (!s.rrule) continue;
    const completedSet = new Set(
      s.completions.map((c) => c.occurrenceDate.getTime()),
    );
    const exByOccurrence = new Map(
      s.exceptions.map((e) => [e.occurrenceDate.getTime(), e]),
    );
    const expandFrom = s.dueDate > windowStart ? s.dueDate : windowStart;
    const occs = expandOccurrences(s.rrule, s.dueDate, expandFrom, tomorrow);
    for (const occ of occs) {
      const ex = exByOccurrence.get(occ.getTime());
      if (ex?.cancelled) continue;
      const isViewedDay = occ.getTime() === date.getTime();
      if (!isViewedDay) {
        if (occ.getTime() >= rolloverCutoff.getTime()) continue;
        if (completedSet.has(occ.getTime())) continue;
      }
      const completion = s.completions.find(
        (c) => c.occurrenceDate.getTime() === occ.getTime(),
      );
      expanded.push({
        id: occurrenceId(s.id, occ),
        seriesId: s.id,
        title: ex?.overrideTitle ?? s.title,
        notes: ex?.overrideNotes ?? s.notes,
        dueDate: occ,
        completedAt: completion?.completedAt ?? null,
        rrule: s.rrule,
        isOccurrence: true,
        occurrenceDate: occ,
      });
    }
  }

  const out: ResolvedTodo[] = [
    ...singles.map((t) => ({
      id: t.id,
      seriesId: t.id,
      title: t.title,
      notes: t.notes,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      rrule: null,
      isOccurrence: false,
      occurrenceDate: null,
    })),
    ...expanded,
  ];
  out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return out;
}

/**
 * Split a resolver result into the shape the digest email consumes.
 * Today's completed items are dropped — the digest only nudges open work.
 * Rolled-over items are sorted oldest-first and stamped with their date.
 */
export function partitionForDigest(
  items: ResolvedTodo[],
  date: Date,
): DigestTodos {
  const today = items
    .filter(
      (t) =>
        t.completedAt === null &&
        t.dueDate.getTime() === date.getTime(),
    )
    .map((t) => ({ title: t.title }));

  const rolledOver = items
    .filter(
      (t) =>
        t.completedAt === null &&
        t.dueDate.getTime() < date.getTime(),
    )
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .map((t) => ({
      title: t.title,
      from: DateTime.fromJSDate(t.dueDate, { zone: "utc" }).toFormat("LLL d"),
    }));

  return { today, rolledOver };
}
```

- [ ] **Step 1.4: Run the parity script — must pass**

Run:

```bash
tsx -r dotenv/config -r ./src/scripts/use-prod-db.ts src/scripts/test-resolve-todos.ts
```

Expected: `✓ ... ✓ all parity checks passed`. If it logs `✗ mismatch`, compare the two JSON strings line-by-line. The most likely culprit is a stray field reordering or missing the `expandFrom = max(dueDate, windowStart)` clamp.

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/todos.ts src/scripts/test-resolve-todos.ts
git commit -m "$(cat <<'EOF'
refactor(todos): extract rollover query into src/lib/todos.ts

Adds resolveTodosForDay (same logic the GET /api/todos route runs
inline today) plus partitionForDigest for the digest's today /
rolled-over split. A parity check script in src/scripts proves the
new helper agrees with the inline implementation on real data; it
gets removed in a later commit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Swap `/api/todos` GET to use the helper

**Files:**
- Modify: `src/app/api/todos/route.ts` (lines 1–110, leaving `POST` at lines 111+ unchanged)

- [ ] **Step 2.1: Replace the inline rollover query with a helper call**

Replace the top of `src/app/api/todos/route.ts` (everything from the imports through the end of the `GET` handler) with:

```ts
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { resolveTodosForDay } from "@/lib/todos";
import { prisma } from "@/lib/db";
import { todoCreateSchema } from "@/schemas/todo";

/**
 * GET /api/todos?date=YYYY-MM-DD returns the visible-on-`date` todo list.
 * The rollover semantics live in resolveTodosForDay so the digest email
 * and the day view share one implementation.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json(
      { error: "Missing or invalid ?date (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  const date = new Date(`${dateParam}T00:00:00.000Z`);
  const todos = await resolveTodosForDay(userId, date);
  return NextResponse.json(todos);
}
```

The `POST` handler below it stays exactly as-is. Drop any now-unused imports the editor reports (`expandOccurrences`, `occurrenceId`, `laTodayISO`).

- [ ] **Step 2.2: Re-run the parity script**

Run:

```bash
tsx -r dotenv/config -r ./src/scripts/use-prod-db.ts src/scripts/test-resolve-todos.ts
```

Expected: still `✓ all parity checks passed`. The helper hasn't moved; only its caller did.

- [ ] **Step 2.3: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: exit 0 with no errors. If TypeScript complains about an unused `prisma` import in `route.ts`, leave it — `POST` still uses it.

- [ ] **Step 2.4: Commit**

```bash
git add src/app/api/todos/route.ts
git commit -m "$(cat <<'EOF'
refactor(todos): GET /api/todos calls resolveTodosForDay

Replaces the inline rollover query with the shared helper. No
behavior change for the UI; verified byte-identical via the parity
check script across real users on today and yesterday.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Update digest email types and template to the two-section shape

**Files:**
- Modify: `src/lib/email.ts` (lines 66–83)
- Modify: `src/emails/TodoDigestEmail.tsx` (whole file)

- [ ] **Step 3.1: Update `TodoDigestEmailInput` and `sendTodoDigestEmail`**

In `src/lib/email.ts`, replace lines 66–83 with:

```ts
export type TodoDigestEmailInput = {
  to: string;
  today: { title: string }[];
  rolledOver: { title: string; from: string }[];
};

export async function sendTodoDigestEmail(input: TodoDigestEmailInput) {
  const { today, rolledOver } = input;
  const props = { today, rolledOver };
  const html = await render(TodoDigestEmail(props));
  const text = await render(TodoDigestEmail(props), { plainText: true });
  const count = today.length + rolledOver.length;
  await client().emails.send({
    from: fromAddress(),
    to: input.to,
    subject: `${count} todos`,
    html,
    text,
  });
}
```

- [ ] **Step 3.2: Replace `TodoDigestEmail.tsx`**

Replace the entire contents of `src/emails/TodoDigestEmail.tsx` with:

```tsx
import {
  Body,
  Container,
  Head,
  Html,
} from "@react-email/components";

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
                  <li key={i} style={{ marginBottom: 4 }}>
                    {t.title}
                  </li>
                ))}
              </ul>
            </>
          )}
          {rolledOver.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>
                Rolled over
              </h2>
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

export default TodoDigestEmail;
```

- [ ] **Step 3.3: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: exit 0. At this point `send-reminders.ts` still calls `sendTodoDigestEmail({ to, todos })` and will fail to type-check — that is a real, intentional error that Task 4 fixes. **If that is the only error, proceed.** Any other errors must be addressed first.

- [ ] **Step 3.4: Commit**

This commit will leave the codebase in a knowingly broken state at the type level (send-reminders.ts still uses the old shape). That's fine — the next task fixes it in one commit. We commit here to keep history readable.

```bash
git add src/lib/email.ts src/emails/TodoDigestEmail.tsx
git commit -m "$(cat <<'EOF'
feat(email): two-section todo digest template

TodoDigestEmail and sendTodoDigestEmail now accept { today,
rolledOver } so the digest can show rolled-over todos under a
separate heading with their original date. The digest call site
in send-reminders.ts is updated in the next commit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Rewire `processTodoDigest` to use the helper and new email shape

**Files:**
- Modify: `src/scripts/send-reminders.ts` (function `processTodoDigest`, lines 439–521)

- [ ] **Step 4.1: Add the helper imports**

In `src/scripts/send-reminders.ts`, find the existing import block (top of file, around lines 19–34) and add:

```ts
import { resolveTodosForDay, partitionForDigest } from "../lib/todos";
```

- [ ] **Step 4.2: Replace the body of `processTodoDigest`**

Replace lines 439 through the closing brace of `processTodoDigest` (around line 521) with:

```ts
async function processTodoDigest(now: Date) {
  // Fire only when the LA wall-clock is in the 12:00 minute. Cron runs every
  // minute so we'll hit this exactly once per day per tick that matches.
  const laNow = DateTime.fromJSDate(now, { zone: "utc" }).setZone(TZ);
  if (laNow.hour !== 12 || laNow.minute !== 0) return;
  const todayLaIso = laNow.toISODate()!;
  const todayUtcMidnight = new Date(`${todayLaIso}T00:00:00.000Z`);

  const users = await prisma.user.findMany({
    where: { notificationsEnabled: true },
    select: { id: true, email: true },
  });

  for (const u of users) {
    const already = await prisma.todoDigestSend.findUnique({
      where: {
        userId_digestDate: { userId: u.id, digestDate: todayUtcMidnight },
      },
    });
    if (already) continue;

    const items = await resolveTodosForDay(u.id, todayUtcMidnight);
    const { today, rolledOver } = partitionForDigest(items, todayUtcMidnight);
    if (today.length === 0 && rolledOver.length === 0) continue;

    try {
      await prisma.todoDigestSend.create({
        data: { userId: u.id, digestDate: todayUtcMidnight },
      });
    } catch {
      continue; // raced with another run
    }
    try {
      await sendTodoDigestEmail({ to: u.email, today, rolledOver });
    } catch (err) {
      console.error(`todo digest send failed for ${u.id}:`, err);
      await prisma.todoDigestSend
        .deleteMany({
          where: { userId: u.id, digestDate: todayUtcMidnight },
        })
        .catch(() => undefined);
    }
  }
}
```

The dedupe write, the catch-and-rollback path, and the noon gate are all preserved. The only structural change is replacing the two inline queries with `resolveTodosForDay` + `partitionForDigest`.

- [ ] **Step 4.3: Type-check**

Run:

```bash
npx tsc --noEmit
```

Expected: exit 0 with no errors anywhere in the codebase.

- [ ] **Step 4.4: Re-run the parity script (sanity)**

Run:

```bash
tsx -r dotenv/config -r ./src/scripts/use-prod-db.ts src/scripts/test-resolve-todos.ts
```

Expected: `✓ all parity checks passed`. (`processTodoDigest` doesn't use the parity script, but a clean re-run confirms nothing in the import graph regressed.)

- [ ] **Step 4.5: Commit**

```bash
git add src/scripts/send-reminders.ts
git commit -m "$(cat <<'EOF'
feat(reminders): noon digest includes rolled-over todos

processTodoDigest now calls resolveTodosForDay and partitionForDigest
so the email lists every todo the day view would show for today
(minus completed items), with rolled-over items grouped under their
own heading. Empty-skip widens to "no items in either section."

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Dry-run smoke verification (no commit)

**Files:**
- Create then delete: `src/scripts/preview-digest.ts`

- [ ] **Step 5.1: Write the one-off preview script**

Create `src/scripts/preview-digest.ts`:

```ts
import "dotenv/config";
import "./use-prod-db";
import { prisma } from "../lib/db";
import { resolveTodosForDay, partitionForDigest } from "../lib/todos";
import { laTodayISO } from "../lib/time";

async function main() {
  const today = new Date(`${laTodayISO()}T00:00:00.000Z`);
  const users = await prisma.user.findMany({
    where: { notificationsEnabled: true },
    select: { id: true, email: true },
  });
  for (const u of users) {
    const items = await resolveTodosForDay(u.id, today);
    const partition = partitionForDigest(items, today);
    if (partition.today.length === 0 && partition.rolledOver.length === 0) {
      console.log(`-- ${u.email}: nothing to send`);
      continue;
    }
    console.log(`== ${u.email} ==`);
    console.log(JSON.stringify(partition, null, 2));
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect().finally(() => process.exit(1));
});
```

- [ ] **Step 5.2: Run it against the prod-mirror DB**

Run:

```bash
tsx -r dotenv/config -r ./src/scripts/use-prod-db.ts src/scripts/preview-digest.ts
```

Expected: a printed `today` / `rolledOver` block for each user with outstanding work. For the project owner (the user from auto-memory), open the calendar in a browser at today's date and confirm that:

1. Every entry under `today` matches a today-dated item on the day view that is not checked off.
2. Every entry under `rolledOver` matches a past-dated incomplete item the day view also shows as rolled over.
3. The `from` field reads as the original date in "May 17" format.
4. Nothing checked-off appears in either section.

If anything is off, stop here and investigate before continuing — do not delete the preview script until the output is correct.

- [ ] **Step 5.3: Delete the preview script**

Run:

```bash
rm src/scripts/preview-digest.ts
```

Do **not** commit this deletion (the file was never committed). Confirm with `git status` that the only outstanding changes are the parity test deletion you'll do in Task 6.

---

## Task 6: Remove the parity test script

**Files:**
- Delete: `src/scripts/test-resolve-todos.ts`

- [ ] **Step 6.1: Delete the script**

Run:

```bash
git rm src/scripts/test-resolve-todos.ts
```

- [ ] **Step 6.2: Type-check one last time**

Run:

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6.3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(todos): remove parity check script

The legacy oracle was useful for the GET /api/todos refactor but
becomes stale baggage now that the helper is the canonical
implementation.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Live smoke after deploy (post-merge, outside the plan boundary)

**Files:** none (operational task).

- [ ] **Step 7.1: Merge and deploy as usual.**

- [ ] **Step 7.2: At the next 12:00 PT tick after deploy**, confirm that a test user with at least one rolled-over incomplete todo receives the digest, that the rendered email shows both a "Today" section and a "Rolled over" section, and that each rolled-over line ends with "(from <Month Day>)". If the inbox shows only "Today" (or only "Rolled over"), the corresponding section was empty for that user — re-check with the preview script against prod credentials.

---

## Self-Review

**Spec coverage:**

- "Digest lists every todo the day view shows minus completed" → Task 1.3 (`partitionForDigest` filters `completedAt === null`), Task 4.2.
- "Rolled-over items visually distinct with original date" → Task 1.3 (`from` field), Task 3.2 (two-section template).
- "API and digest share one query implementation" → Task 1.3 (`resolveTodosForDay`), Task 2.1 (route uses it), Task 4.2 (digest uses it).
- "No JSON contract change for `GET /api/todos`" → Task 1.4 parity script + Task 2.2 re-run.
- "No change to cron cadence / dedupe semantics" → Task 4.2 keeps the noon gate, `TodoDigestSend` write/rollback path, and per-user loop intact.
- Verification: parity check (Task 1.2/1.4/2.2), dry-run (Task 5.2), live smoke (Task 7.2). All three covered.

**Placeholder scan:** No TBDs, no "implement later," every step has runnable commands or complete code blocks.

**Type consistency:** `ResolvedTodo` (Task 1.3) matches the historical `Wire` shape used by the legacy oracle (Task 1.1). `DigestTodos` (Task 1.3) matches the new `TodoDigestEmailInput` props (Task 3.1) and the `TodoDigestEmail` component props (Task 3.2). `resolveTodosForDay` and `partitionForDigest` signatures are referenced identically in Tasks 4.1, 4.2, and 5.1.

**Scope:** Single coordinated change, six commits, ~250 net lines (most of which is moved code).
