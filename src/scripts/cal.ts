/**
 * Calendar CLI — read/write the personal calendar from the shell.
 *
 * Invocation: `npm run cal -- <command> [args]`.
 *
 * Designed for agent use (Claude Code, including the Cloud agent). User is
 * hardcoded to renzo@learnversa.com and looked up once per invocation. All
 * writes go through the same Zod schemas the HTTP API uses, so the CLI can't
 * write rows that the app would later choke on.
 *
 * Output: JSON to stdout. Errors as {error: "..."} to stderr with non-zero
 * exit. Date inputs follow the rest of the app — LA-local "YYYY-MM-DDTHH:mm"
 * for timed fields, "YYYY-MM-DD" for date-only fields.
 */

import "dotenv/config";
import { DateTime } from "luxon";
import { z } from "zod";
import { prisma } from "../lib/db";
import { TZ, fromLocalInputValue } from "../lib/time";
import {
  computeSeriesEndUtc,
  expandOccurrences,
  occurrenceId,
} from "../lib/recurrence";
import {
  eventCreateSchema,
  eventUpdateSchema,
} from "../schemas/event";
import {
  bigEventCreateSchema,
  bigEventUpdateSchema,
} from "../schemas/bigEvent";
import { todoCreateSchema, todoUpdateSchema } from "../schemas/todo";
import {
  dueDateCreateSchema,
  dueDateUpdateSchema,
} from "../schemas/dueDate";

const USER_EMAIL = "rfukuda06@gmail.com";

// ---------- helpers ----------

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
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail("invalid JSON on stdin", { detail: String(e) });
  }
}

type Flags = {
  positional: string[];
  named: Record<string, string | true>;
};

function parseFlags(argv: string[]): Flags {
  const positional: string[] = [];
  const named: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        named[key] = true;
      } else {
        named[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, named };
}

function requireFlag(flags: Flags, name: string): string {
  const v = flags.named[name];
  if (typeof v !== "string") fail(`missing required --${name}`);
  return v;
}

/** Default list window: today (LA) through +30 days. */
function defaultRange(flags: Flags): { from: Date; to: Date } {
  const today = DateTime.now().setZone(TZ).startOf("day");
  const fromIso = (flags.named.from as string) ?? today.toISODate()!;
  const toIso =
    (flags.named.to as string) ?? today.plus({ days: 30 }).toISODate()!;
  const from = DateTime.fromISO(fromIso, { zone: TZ }).startOf("day");
  const to = DateTime.fromISO(toIso, { zone: TZ }).startOf("day").plus({ days: 1 });
  if (!from.isValid || !to.isValid) fail("--from/--to must be YYYY-MM-DD");
  return { from: from.toUTC().toJSDate(), to: to.toUTC().toJSDate() };
}

async function resolveUserId(): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { email: USER_EMAIL },
    select: { id: true },
  });
  if (!u) fail(`no user with email ${USER_EMAIL}`);
  return u.id;
}

// Zod is used at parse time; convert any Zod error into a CLI failure.
function parseOrFail<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    fail("validation failed", { issues: r.error.issues });
  }
  return r.data;
}

/** Parse an occurrence reference. Datetime for Event/DueDate, date for
 *  BigEvent/Todo. Returns a UTC Date matching the schema column. */
function parseOccurrenceDatetime(s: string): Date {
  // Accept "YYYY-MM-DDTHH:mm" (LA local) or full ISO.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return fromLocalInputValue(s);
  const d = new Date(s);
  if (isNaN(d.getTime())) fail(`bad --occurrence: ${s}`);
  return d;
}

function parseOccurrenceDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`--occurrence must be YYYY-MM-DD (got ${s})`);
  return new Date(`${s}T00:00:00.000Z`);
}

// ---------- events ----------

async function listEvents(userId: string, flags: Flags) {
  const { from, to } = defaultRange(flags);
  const rows = await prisma.event.findMany({
    where: {
      userId,
      OR: [
        // Non-recurring overlapping window.
        { rrule: null, startUtc: { lt: to }, endUtc: { gt: from } },
        // Recurring: cheap prune via seriesEndUtc (null = open-ended).
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

  type Occ = {
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
  const occs: Occ[] = [];

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
    const exByStart = new Map(
      ev.exceptions.map((e) => [e.originalStartUtc.getTime(), e]),
    );
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
  out(occs);
}

async function createEvent(userId: string) {
  const input = parseOrFail(eventCreateSchema, await readStdinJson());
  const seriesEndUtc = input.rrule
    ? computeSeriesEndUtc(input.rrule, input.startUtc)
    : null;
  const created = await prisma.event.create({
    data: {
      userId,
      title: input.title,
      notes: input.notes ?? null,
      startUtc: input.startUtc,
      endUtc: input.endUtc,
      rrule: input.rrule ?? null,
      seriesEndUtc,
      categoryId: input.categoryId ?? null,
      reminders: input.reminders
        ? {
            create: input.reminders.map((r) => ({
              userId,
              offsetMinutes: r.offsetMinutes,
            })),
          }
        : undefined,
    },
  });
  out(created);
}

async function updateEvent(userId: string, flags: Flags) {
  const id = flags.positional[1];
  if (!id) fail("usage: update-event <id>");
  const input = parseOrFail(eventUpdateSchema, await readStdinJson());
  const existing = await prisma.event.findFirst({ where: { id, userId } });
  if (!existing) fail("event not found");

  const nextStart = input.startUtc ?? existing.startUtc;
  const nextRrule = input.rrule === undefined ? existing.rrule : input.rrule;
  const seriesEndUtc = nextRrule
    ? computeSeriesEndUtc(nextRrule, nextStart)
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    const ev = await tx.event.update({
      where: { id },
      data: {
        title: input.title,
        notes: input.notes,
        startUtc: input.startUtc,
        endUtc: input.endUtc,
        rrule: input.rrule,
        seriesEndUtc,
        categoryId: input.categoryId,
      },
    });
    if (input.reminders !== undefined) {
      await tx.reminder.deleteMany({ where: { eventId: id } });
      if (input.reminders.length > 0) {
        await tx.reminder.createMany({
          data: input.reminders.map((r) => ({
            userId,
            eventId: id,
            offsetMinutes: r.offsetMinutes,
          })),
        });
      }
    }
    return ev;
  });
  out(updated);
}

async function deleteEvent(userId: string, flags: Flags) {
  const id = flags.positional[1];
  if (!id) fail("usage: delete-event <id>");
  const ev = await prisma.event.findFirst({ where: { id, userId } });
  if (!ev) fail("event not found");
  await prisma.event.delete({ where: { id } });
  out({ ok: true });
}

// ---------- todos ----------

async function listTodos(userId: string, flags: Flags) {
  const { from, to } = defaultRange(flags);
  const rows = await prisma.todo.findMany({
    where: { userId },
    include: {
      exceptions: true,
      completions: true,
    },
    orderBy: { dueDate: "asc" },
  });

  type TOcc = {
    id: string;
    seriesId: string | null;
    title: string;
    notes: string | null;
    dueDate: string; // YYYY-MM-DD
    rrule: string | null;
    completed: boolean;
  };
  const occs: TOcc[] = [];

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
    const exByDate = new Map(
      t.exceptions.map((e) => [e.occurrenceDate.getTime(), e]),
    );
    const completedSet = new Set(
      t.completions.map((c) => c.occurrenceDate.getTime()),
    );
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
  out(occs);
}

async function createTodo(userId: string) {
  const input = parseOrFail(todoCreateSchema, await readStdinJson());
  const created = await prisma.todo.create({
    data: {
      userId,
      title: input.title,
      notes: input.notes ?? null,
      dueDate: input.dueDate,
      rrule: input.rrule ?? null,
    },
  });
  out(created);
}

async function updateTodo(userId: string, flags: Flags) {
  const id = flags.positional[1];
  if (!id) fail("usage: update-todo <id>");
  const input = parseOrFail(todoUpdateSchema, await readStdinJson());
  const existing = await prisma.todo.findFirst({ where: { id, userId } });
  if (!existing) fail("todo not found");
  const updated = await prisma.todo.update({
    where: { id },
    data: {
      title: input.title,
      notes: input.notes,
      dueDate: input.dueDate,
      rrule: input.rrule,
      completedAt: input.completedAt,
    },
  });
  out(updated);
}

async function completeTodo(userId: string, flags: Flags, completed: boolean) {
  const id = flags.positional[1];
  if (!id) fail(`usage: ${completed ? "complete" : "uncomplete"}-todo <id>`);
  const t = await prisma.todo.findFirst({ where: { id, userId } });
  if (!t) fail("todo not found");

  const occ = flags.named.occurrence as string | undefined;
  if (t.rrule) {
    if (!occ) fail("recurring todo requires --occurrence YYYY-MM-DD");
    const occDate = parseOccurrenceDate(occ);
    if (completed) {
      await prisma.todoCompletion.upsert({
        where: {
          todoId_occurrenceDate: { todoId: id, occurrenceDate: occDate },
        },
        update: {},
        create: { todoId: id, occurrenceDate: occDate },
      });
    } else {
      await prisma.todoCompletion.deleteMany({
        where: { todoId: id, occurrenceDate: occDate },
      });
    }
  } else {
    await prisma.todo.update({
      where: { id },
      data: { completedAt: completed ? new Date() : null },
    });
  }
  out({ ok: true });
}

async function deleteTodo(userId: string, flags: Flags) {
  const id = flags.positional[1];
  if (!id) fail("usage: delete-todo <id>");
  const t = await prisma.todo.findFirst({ where: { id, userId } });
  if (!t) fail("todo not found");
  await prisma.todo.delete({ where: { id } });
  out({ ok: true });
}

// ---------- big events ----------

async function listBigEvents(userId: string, flags: Flags) {
  const { from, to } = defaultRange(flags);
  const rows = await prisma.bigEvent.findMany({
    where: { userId },
    include: { exceptions: true, category: true },
    orderBy: { date: "asc" },
  });

  type BOcc = {
    id: string;
    seriesId: string | null;
    title: string;
    notes: string | null;
    date: string;
    rrule: string | null;
    categoryId: string | null;
    categoryName: string | null;
  };
  const occs: BOcc[] = [];

  for (const be of rows) {
    if (!be.rrule) {
      if (be.date < from || be.date >= to) continue;
      occs.push({
        id: be.id,
        seriesId: null,
        title: be.title,
        notes: be.notes,
        date: be.date.toISOString().slice(0, 10),
        rrule: null,
        categoryId: be.categoryId,
        categoryName: be.category?.name ?? null,
      });
      continue;
    }
    const exByDate = new Map(
      be.exceptions.map((e) => [e.originalDate.getTime(), e]),
    );
    const dates = expandOccurrences(be.rrule, be.date, from, to);
    for (const orig of dates) {
      const ex = exByDate.get(orig.getTime());
      if (ex?.cancelled) continue;
      occs.push({
        id: occurrenceId(be.id, orig),
        seriesId: be.id,
        title: ex?.overrideTitle ?? be.title,
        notes: ex?.overrideNotes ?? be.notes,
        date: orig.toISOString().slice(0, 10),
        rrule: be.rrule,
        categoryId: ex?.overrideCategoryId ?? be.categoryId,
        categoryName: be.category?.name ?? null,
      });
    }
  }

  occs.sort((a, b) => a.date.localeCompare(b.date));
  out(occs);
}

async function createBigEvent(userId: string) {
  const input = parseOrFail(bigEventCreateSchema, await readStdinJson());
  const created = await prisma.bigEvent.create({
    data: {
      userId,
      title: input.title,
      notes: input.notes ?? null,
      date: input.date,
      rrule: input.rrule ?? null,
      categoryId: input.categoryId ?? null,
      reminders: input.reminders
        ? {
            create: input.reminders.map((r) => ({
              userId,
              daysBefore: r.daysBefore,
            })),
          }
        : undefined,
    },
  });
  out(created);
}

async function updateBigEvent(userId: string, flags: Flags) {
  const id = flags.positional[1];
  if (!id) fail("usage: update-big-event <id>");
  const input = parseOrFail(bigEventUpdateSchema, await readStdinJson());
  const existing = await prisma.bigEvent.findFirst({ where: { id, userId } });
  if (!existing) fail("big event not found");
  const updated = await prisma.$transaction(async (tx) => {
    const be = await tx.bigEvent.update({
      where: { id },
      data: {
        title: input.title,
        notes: input.notes,
        date: input.date,
        rrule: input.rrule,
        categoryId: input.categoryId,
      },
    });
    if (input.reminders !== undefined) {
      await tx.reminder.deleteMany({ where: { bigEventId: id } });
      if (input.reminders.length > 0) {
        await tx.reminder.createMany({
          data: input.reminders.map((r) => ({
            userId,
            bigEventId: id,
            daysBefore: r.daysBefore,
          })),
        });
      }
    }
    return be;
  });
  out(updated);
}

async function deleteBigEvent(userId: string, flags: Flags) {
  const id = flags.positional[1];
  if (!id) fail("usage: delete-big-event <id>");
  const be = await prisma.bigEvent.findFirst({ where: { id, userId } });
  if (!be) fail("big event not found");
  await prisma.bigEvent.delete({ where: { id } });
  out({ ok: true });
}

// ---------- due dates ----------

async function listDueDates(userId: string, flags: Flags) {
  const { from, to } = defaultRange(flags);
  const rows = await prisma.dueDate.findMany({
    where: { userId },
    include: { exceptions: true, category: true },
    orderBy: { dueAt: "asc" },
  });

  type DOcc = {
    id: string;
    seriesId: string | null;
    title: string;
    dueAt: string;
    rrule: string | null;
    categoryId: string | null;
    categoryName: string | null;
  };
  const occs: DOcc[] = [];

  for (const dd of rows) {
    if (!dd.rrule) {
      if (dd.dueAt < from || dd.dueAt >= to) continue;
      occs.push({
        id: dd.id,
        seriesId: null,
        title: dd.title,
        dueAt: dd.dueAt.toISOString(),
        rrule: null,
        categoryId: dd.categoryId,
        categoryName: dd.category?.name ?? null,
      });
      continue;
    }
    const exByDue = new Map(
      dd.exceptions.map((e) => [e.originalDueAt.getTime(), e]),
    );
    const dues = expandOccurrences(dd.rrule, dd.dueAt, from, to);
    for (const orig of dues) {
      const ex = exByDue.get(orig.getTime());
      if (ex?.cancelled) continue;
      const dueAt = ex?.overrideDueAt ?? orig;
      occs.push({
        id: occurrenceId(dd.id, orig),
        seriesId: dd.id,
        title: ex?.overrideTitle ?? dd.title,
        dueAt: dueAt.toISOString(),
        rrule: dd.rrule,
        categoryId: ex?.overrideCategoryId ?? dd.categoryId,
        categoryName: dd.category?.name ?? null,
      });
    }
  }

  occs.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  out(occs);
}

async function createDueDate(userId: string) {
  const input = parseOrFail(dueDateCreateSchema, await readStdinJson());
  const created = await prisma.dueDate.create({
    data: {
      userId,
      title: input.title,
      dueAt: input.dueAt,
      rrule: input.rrule ?? null,
      categoryId: input.categoryId ?? null,
      reminders: input.reminders
        ? {
            create: input.reminders.map((r) => ({
              userId,
              offsetMinutes: r.offsetMinutes,
            })),
          }
        : undefined,
    },
  });
  out(created);
}

async function updateDueDate(userId: string, flags: Flags) {
  const id = flags.positional[1];
  if (!id) fail("usage: update-due-date <id>");
  const input = parseOrFail(dueDateUpdateSchema, await readStdinJson());
  const existing = await prisma.dueDate.findFirst({ where: { id, userId } });
  if (!existing) fail("due date not found");
  const updated = await prisma.$transaction(async (tx) => {
    const dd = await tx.dueDate.update({
      where: { id },
      data: {
        title: input.title,
        dueAt: input.dueAt,
        rrule: input.rrule,
        categoryId: input.categoryId,
      },
    });
    if (input.reminders !== undefined) {
      await tx.reminder.deleteMany({ where: { dueDateId: id } });
      if (input.reminders.length > 0) {
        await tx.reminder.createMany({
          data: input.reminders.map((r) => ({
            userId,
            dueDateId: id,
            offsetMinutes: r.offsetMinutes,
          })),
        });
      }
    }
    return dd;
  });
  out(updated);
}

async function deleteDueDate(userId: string, flags: Flags) {
  const id = flags.positional[1];
  if (!id) fail("usage: delete-due-date <id>");
  const dd = await prisma.dueDate.findFirst({ where: { id, userId } });
  if (!dd) fail("due date not found");
  await prisma.dueDate.delete({ where: { id } });
  out({ ok: true });
}

// ---------- reminders ----------

type ReminderTarget = "event" | "big-event" | "due-date";

function reminderTarget(flags: Flags): { target: ReminderTarget; id: string } {
  for (const t of ["event", "big-event", "due-date"] as const) {
    const id = flags.named[t];
    if (typeof id === "string") return { target: t, id };
  }
  fail("specify --event <id>, --big-event <id>, or --due-date <id>");
}

async function listReminders(userId: string, flags: Flags) {
  const { target, id } = reminderTarget(flags);
  const where =
    target === "event"
      ? { eventId: id, userId }
      : target === "big-event"
        ? { bigEventId: id, userId }
        : { dueDateId: id, userId };
  const rows = await prisma.reminder.findMany({ where });
  out(rows);
}

async function addReminder(userId: string, flags: Flags) {
  const { target, id } = reminderTarget(flags);
  const body = (await readStdinJson()) as Record<string, unknown>;
  if (target === "big-event") {
    const parsed = z.object({ daysBefore: z.number().int().min(0).max(365) }).safeParse(body);
    if (!parsed.success) fail("validation failed", { issues: parsed.error.issues });
    // Verify parent ownership.
    const be = await prisma.bigEvent.findFirst({ where: { id, userId } });
    if (!be) fail("big event not found");
    const r = await prisma.reminder.create({
      data: { userId, bigEventId: id, daysBefore: parsed.data.daysBefore },
    });
    out(r);
  } else {
    const parsed = z
      .object({ offsetMinutes: z.number().int().min(0).max(60 * 24 * 365) })
      .safeParse(body);
    if (!parsed.success) fail("validation failed", { issues: parsed.error.issues });
    if (target === "event") {
      const ev = await prisma.event.findFirst({ where: { id, userId } });
      if (!ev) fail("event not found");
      const r = await prisma.reminder.create({
        data: { userId, eventId: id, offsetMinutes: parsed.data.offsetMinutes },
      });
      out(r);
    } else {
      const dd = await prisma.dueDate.findFirst({ where: { id, userId } });
      if (!dd) fail("due date not found");
      const r = await prisma.reminder.create({
        data: {
          userId,
          dueDateId: id,
          offsetMinutes: parsed.data.offsetMinutes,
        },
      });
      out(r);
    }
  }
}

async function removeReminder(userId: string, flags: Flags) {
  const id = flags.positional[1];
  if (!id) fail("usage: remove-reminder <id>");
  const r = await prisma.reminder.findFirst({ where: { id, userId } });
  if (!r) fail("reminder not found");
  await prisma.reminder.delete({ where: { id } });
  out({ ok: true });
}

// ---------- categories ----------

async function listCategories(userId: string) {
  const rows = await prisma.category.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
  out(rows);
}

// ---------- occurrence exceptions ----------

// Per-occurrence override. Upserts an exception row for the named occurrence
// of a recurring series. Whichever fields are present override that one
// occurrence; `cancelled: true` cancels just that one. The shape varies a
// little per parent type because the exception tables have different
// override columns.

const eventExceptionInputSchema = z
  .object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideNotes: z.string().max(4000).nullable().optional(),
    overrideStartUtc: z.coerce.date().optional(),
    overrideEndUtc: z.coerce.date().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "empty override");

const bigEventExceptionInputSchema = z
  .object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideNotes: z.string().max(4000).nullable().optional(),
    overrideCategoryId: z.string().cuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "empty override");

const todoExceptionInputSchema = z
  .object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideNotes: z.string().max(4000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "empty override");

const dueDateExceptionInputSchema = z
  .object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideDueAt: z.coerce.date().optional(),
    overrideCategoryId: z.string().cuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "empty override");

function exceptionTarget(flags: Flags): {
  target: ReminderTarget | "todo";
  id: string;
} {
  for (const t of ["event", "big-event", "todo", "due-date"] as const) {
    const id = flags.named[t];
    if (typeof id === "string") return { target: t, id };
  }
  fail("specify --event, --big-event, --todo, or --due-date <id>");
}

async function setOccurrence(userId: string, flags: Flags) {
  const { target, id } = exceptionTarget(flags);
  const occ = requireFlag(flags, "occurrence");
  const body = await readStdinJson();

  if (target === "event") {
    const ev = await prisma.event.findFirst({ where: { id, userId } });
    if (!ev || !ev.rrule) fail("recurring event not found");
    const data = parseOrFail(eventExceptionInputSchema, body);
    const originalStartUtc = parseOccurrenceDatetime(occ);
    const row = await prisma.eventException.upsert({
      where: { eventId_originalStartUtc: { eventId: id, originalStartUtc } },
      create: { eventId: id, originalStartUtc, ...data },
      update: data,
    });
    out(row);
  } else if (target === "big-event") {
    const be = await prisma.bigEvent.findFirst({ where: { id, userId } });
    if (!be || !be.rrule) fail("recurring big event not found");
    const data = parseOrFail(bigEventExceptionInputSchema, body);
    const originalDate = parseOccurrenceDate(occ);
    const row = await prisma.bigEventException.upsert({
      where: { bigEventId_originalDate: { bigEventId: id, originalDate } },
      create: { bigEventId: id, originalDate, ...data },
      update: data,
    });
    out(row);
  } else if (target === "todo") {
    const t = await prisma.todo.findFirst({ where: { id, userId } });
    if (!t || !t.rrule) fail("recurring todo not found");
    const data = parseOrFail(todoExceptionInputSchema, body);
    const occurrenceDate = parseOccurrenceDate(occ);
    const row = await prisma.todoException.upsert({
      where: { todoId_occurrenceDate: { todoId: id, occurrenceDate } },
      create: { todoId: id, occurrenceDate, ...data },
      update: data,
    });
    out(row);
  } else {
    const dd = await prisma.dueDate.findFirst({ where: { id, userId } });
    if (!dd || !dd.rrule) fail("recurring due date not found");
    const data = parseOrFail(dueDateExceptionInputSchema, body);
    const originalDueAt = parseOccurrenceDatetime(occ);
    const row = await prisma.dueDateException.upsert({
      where: {
        dueDateId_originalDueAt: { dueDateId: id, originalDueAt },
      },
      create: { dueDateId: id, originalDueAt, ...data },
      update: data,
    });
    out(row);
  }
}

async function clearOccurrence(userId: string, flags: Flags) {
  const { target, id } = exceptionTarget(flags);
  const occ = requireFlag(flags, "occurrence");

  if (target === "event") {
    const ev = await prisma.event.findFirst({ where: { id, userId } });
    if (!ev) fail("event not found");
    await prisma.eventException.deleteMany({
      where: { eventId: id, originalStartUtc: parseOccurrenceDatetime(occ) },
    });
  } else if (target === "big-event") {
    const be = await prisma.bigEvent.findFirst({ where: { id, userId } });
    if (!be) fail("big event not found");
    await prisma.bigEventException.deleteMany({
      where: { bigEventId: id, originalDate: parseOccurrenceDate(occ) },
    });
  } else if (target === "todo") {
    const t = await prisma.todo.findFirst({ where: { id, userId } });
    if (!t) fail("todo not found");
    await prisma.todoException.deleteMany({
      where: { todoId: id, occurrenceDate: parseOccurrenceDate(occ) },
    });
  } else {
    const dd = await prisma.dueDate.findFirst({ where: { id, userId } });
    if (!dd) fail("due date not found");
    await prisma.dueDateException.deleteMany({
      where: { dueDateId: id, originalDueAt: parseOccurrenceDatetime(occ) },
    });
  }
  out({ ok: true });
}

// ---------- help ----------

const HELP = `
Calendar CLI. User: ${USER_EMAIL}.

Reads: list-events, list-todos, list-big-events, list-due-dates,
       list-reminders, list-categories
Writes (JSON stdin): create-event, update-event <id>,
       create-todo, update-todo <id>,
       create-big-event, update-big-event <id>,
       create-due-date, update-due-date <id>,
       add-reminder, set-occurrence
Deletes / toggles: delete-event <id>, delete-todo <id>, delete-big-event <id>,
       delete-due-date <id>, remove-reminder <id>,
       complete-todo <id> [--occurrence YYYY-MM-DD],
       uncomplete-todo <id> [--occurrence YYYY-MM-DD],
       clear-occurrence

Range flags for list-*: --from YYYY-MM-DD --to YYYY-MM-DD (LA local).
Default range: today through +30 days.

Reminder commands take --event <id> | --big-event <id> | --due-date <id>.
Occurrence commands also accept --todo <id>; --occurrence is YYYY-MM-DD
for big-event/todo, YYYY-MM-DDTHH:mm (LA) for event/due-date.

All output is JSON on stdout. Errors are JSON on stderr with non-zero exit.
`.trim();

// ---------- main ----------

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP + "\n");
    return;
  }
  const flags = parseFlags(argv);
  const userId = await resolveUserId();

  switch (cmd) {
    case "list-events": return listEvents(userId, flags);
    case "create-event": return createEvent(userId);
    case "update-event": return updateEvent(userId, flags);
    case "delete-event": return deleteEvent(userId, flags);

    case "list-todos": return listTodos(userId, flags);
    case "create-todo": return createTodo(userId);
    case "update-todo": return updateTodo(userId, flags);
    case "complete-todo": return completeTodo(userId, flags, true);
    case "uncomplete-todo": return completeTodo(userId, flags, false);
    case "delete-todo": return deleteTodo(userId, flags);

    case "list-big-events": return listBigEvents(userId, flags);
    case "create-big-event": return createBigEvent(userId);
    case "update-big-event": return updateBigEvent(userId, flags);
    case "delete-big-event": return deleteBigEvent(userId, flags);

    case "list-due-dates": return listDueDates(userId, flags);
    case "create-due-date": return createDueDate(userId);
    case "update-due-date": return updateDueDate(userId, flags);
    case "delete-due-date": return deleteDueDate(userId, flags);

    case "list-reminders": return listReminders(userId, flags);
    case "add-reminder": return addReminder(userId, flags);
    case "remove-reminder": return removeReminder(userId, flags);

    case "list-categories": return listCategories(userId);

    case "set-occurrence": return setOccurrence(userId, flags);
    case "clear-occurrence": return clearOccurrence(userId, flags);

    default:
      fail(`unknown command: ${cmd}. run \`npm run cal -- help\` for usage.`);
  }
}

main()
  .catch((err) => {
    process.stderr.write(JSON.stringify({ error: String(err?.message ?? err) }) + "\n");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
