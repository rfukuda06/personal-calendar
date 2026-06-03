import { prisma } from "./db";
import { DateTime } from "luxon";
import { TZ, fromLocalInputValue } from "./time";
import { computeSeriesEndUtc, expandOccurrences, occurrenceId } from "./recurrence";
import { eventCreateSchema, eventUpdateSchema } from "../schemas/event";
import { todoCreateSchema, todoUpdateSchema } from "../schemas/todo";
import { bigEventCreateSchema, bigEventUpdateSchema } from "../schemas/bigEvent";
import { dueDateCreateSchema, dueDateUpdateSchema } from "../schemas/dueDate";
import { z } from "zod";

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

/**
 * Default list window: today (LA) through +30 days. Accepts optional
 * YYYY-MM-DD overrides. Returns UTC Date pair matching the schema columns.
 *
 * Use this for columns that store full UTC instants (Event.startUtc,
 * DueDate.dueAt). For columns that store date-only labels as midnight UTC
 * (@db.Date — Todo.dueDate, BigEvent.date), use resolveDateRange instead.
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

/**
 * Date-only range resolver for `@db.Date` columns (Todo.dueDate,
 * BigEvent.date). Those columns store a calendar-day *label* as midnight UTC,
 * not an instant in LA. Comparing them against `resolveRange`'s LA→UTC bounds
 * shifts every single-day query forward by 7-8 hours, which excludes the
 * day's actual rows and includes the next day's instead.
 *
 * This variant treats `--from`/`--to` as date labels: from = midnight UTC of
 * the from date, to = midnight UTC of (to date + 1 day) (exclusive upper).
 * Defaults match resolveRange (today LA through +30 days).
 */
export function resolveDateRange(fromIso?: string, toIso?: string): { from: Date; to: Date } {
  const today = DateTime.now().setZone(TZ).startOf("day");
  const f = fromIso ?? today.toISODate()!;
  const t = toIso ?? today.plus({ days: 30 }).toISODate()!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new CalendarOpError("bad-range", "--from/--to must be YYYY-MM-DD");
  }
  const to = DateTime.fromISO(t, { zone: "utc" }).startOf("day").plus({ days: 1 });
  return {
    from: new Date(`${f}T00:00:00.000Z`),
    to: to.toJSDate(),
  };
}

export function parseOccurrenceDatetime(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return fromLocalInputValue(s);
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    throw new CalendarOpError("bad-occurrence", `bad occurrence datetime: ${s}`);
  }
  return d;
}

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
        categoryId: ex?.overrideCategoryId ?? ev.categoryId,
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

// ---------------------------------------------------------------------------
// Todo ops
// ---------------------------------------------------------------------------

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
  const { from, to } = resolveDateRange(params.from, params.to);
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

export async function createTodoOp(userId: string, input: unknown) {
  const parsed = todoCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "createTodo: validation failed", { issues: parsed.error.issues });
  }
  const data = parsed.data;
  return prisma.todo.create({
    data: {
      userId,
      title: data.title,
      notes: data.notes ?? null,
      dueDate: data.dueDate,
      rrule: data.rrule ?? null,
    },
  });
}

export async function updateTodoOp(userId: string, id: string, input: unknown) {
  const parsed = todoUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "updateTodo: validation failed", { issues: parsed.error.issues });
  }
  const data = parsed.data;
  const existing = await prisma.todo.findFirst({ where: { id, userId } });
  if (!existing) throw new CalendarOpError("not-found", "todo not found");
  return prisma.todo.update({
    where: { id },
    data: {
      title: data.title,
      notes: data.notes,
      dueDate: data.dueDate,
      rrule: data.rrule,
      completedAt: data.completedAt,
    },
  });
}

export async function completeTodoOp(
  userId: string,
  id: string,
  completed: boolean,
  occurrence?: string,
) {
  const t = await prisma.todo.findFirst({ where: { id, userId } });
  if (!t) throw new CalendarOpError("not-found", "todo not found");
  if (t.rrule) {
    if (!occurrence) {
      throw new CalendarOpError("bad-occurrence", "recurring todo requires occurrence YYYY-MM-DD");
    }
    const occDate = parseDateOnly(occurrence);
    if (completed) {
      await prisma.todoCompletion.upsert({
        where: { todoId_occurrenceDate: { todoId: id, occurrenceDate: occDate } },
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
  return { ok: true as const };
}

export async function deleteTodoOp(userId: string, id: string) {
  const t = await prisma.todo.findFirst({ where: { id, userId } });
  if (!t) throw new CalendarOpError("not-found", "todo not found");
  await prisma.todo.delete({ where: { id } });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Big-event ops
// ---------------------------------------------------------------------------

export type BigEventOccurrence = {
  id: string;
  seriesId: string | null;
  title: string;
  notes: string | null;
  date: string;
  rrule: string | null;
  categoryId: string | null;
  categoryName: string | null;
};

export async function listBigEventsOp(
  userId: string,
  params: { from?: string; to?: string },
): Promise<BigEventOccurrence[]> {
  const { from, to } = resolveDateRange(params.from, params.to);
  const rows = await prisma.bigEvent.findMany({
    where: { userId },
    include: { exceptions: true, category: true },
    orderBy: { date: "asc" },
  });
  const occs: BigEventOccurrence[] = [];
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
    const exByDate = new Map(be.exceptions.map((e) => [e.originalDate.getTime(), e]));
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
  return occs;
}

export async function createBigEventOp(userId: string, input: unknown) {
  const parsed = bigEventCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "createBigEvent: validation failed", { issues: parsed.error.issues });
  }
  const data = parsed.data;
  return prisma.bigEvent.create({
    data: {
      userId,
      title: data.title,
      notes: data.notes ?? null,
      date: data.date,
      rrule: data.rrule ?? null,
      categoryId: data.categoryId ?? null,
      reminders: data.reminders
        ? { create: data.reminders.map((r) => ({ userId, daysBefore: r.daysBefore })) }
        : undefined,
    },
  });
}

export async function updateBigEventOp(userId: string, id: string, input: unknown) {
  const parsed = bigEventUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "updateBigEvent: validation failed", { issues: parsed.error.issues });
  }
  const data = parsed.data;
  const existing = await prisma.bigEvent.findFirst({ where: { id, userId } });
  if (!existing) throw new CalendarOpError("not-found", "big event not found");
  return prisma.$transaction(async (tx) => {
    const be = await tx.bigEvent.update({
      where: { id },
      data: {
        title: data.title,
        notes: data.notes,
        date: data.date,
        rrule: data.rrule,
        categoryId: data.categoryId,
      },
    });
    if (data.reminders !== undefined) {
      await tx.reminder.deleteMany({ where: { bigEventId: id } });
      if (data.reminders.length > 0) {
        await tx.reminder.createMany({
          data: data.reminders.map((r) => ({ userId, bigEventId: id, daysBefore: r.daysBefore })),
        });
      }
    }
    return be;
  });
}

export async function deleteBigEventOp(userId: string, id: string) {
  const be = await prisma.bigEvent.findFirst({ where: { id, userId } });
  if (!be) throw new CalendarOpError("not-found", "big event not found");
  await prisma.bigEvent.delete({ where: { id } });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Due-date ops
// ---------------------------------------------------------------------------

export type DueDateOccurrence = {
  id: string;
  seriesId: string | null;
  title: string;
  dueAt: string;
  rrule: string | null;
  categoryId: string | null;
  categoryName: string | null;
};

export async function listDueDatesOp(
  userId: string,
  params: { from?: string; to?: string },
): Promise<DueDateOccurrence[]> {
  const { from, to } = resolveRange(params.from, params.to);
  const rows = await prisma.dueDate.findMany({
    where: { userId },
    include: { exceptions: true, category: true },
    orderBy: { dueAt: "asc" },
  });
  const occs: DueDateOccurrence[] = [];
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
    const exByDue = new Map(dd.exceptions.map((e) => [e.originalDueAt.getTime(), e]));
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
  return occs;
}

export async function createDueDateOp(userId: string, input: unknown) {
  const parsed = dueDateCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "createDueDate: validation failed", { issues: parsed.error.issues });
  }
  const data = parsed.data;
  return prisma.dueDate.create({
    data: {
      userId,
      title: data.title,
      dueAt: data.dueAt,
      rrule: data.rrule ?? null,
      categoryId: data.categoryId ?? null,
      reminders: data.reminders
        ? { create: data.reminders.map((r) => ({ userId, offsetMinutes: r.offsetMinutes })) }
        : undefined,
    },
  });
}

export async function updateDueDateOp(userId: string, id: string, input: unknown) {
  const parsed = dueDateUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "updateDueDate: validation failed", { issues: parsed.error.issues });
  }
  const data = parsed.data;
  const existing = await prisma.dueDate.findFirst({ where: { id, userId } });
  if (!existing) throw new CalendarOpError("not-found", "due date not found");
  return prisma.$transaction(async (tx) => {
    const dd = await tx.dueDate.update({
      where: { id },
      data: {
        title: data.title,
        dueAt: data.dueAt,
        rrule: data.rrule,
        categoryId: data.categoryId,
      },
    });
    if (data.reminders !== undefined) {
      await tx.reminder.deleteMany({ where: { dueDateId: id } });
      if (data.reminders.length > 0) {
        await tx.reminder.createMany({
          data: data.reminders.map((r) => ({ userId, dueDateId: id, offsetMinutes: r.offsetMinutes })),
        });
      }
    }
    return dd;
  });
}

export async function deleteDueDateOp(userId: string, id: string) {
  const dd = await prisma.dueDate.findFirst({ where: { id, userId } });
  if (!dd) throw new CalendarOpError("not-found", "due date not found");
  await prisma.dueDate.delete({ where: { id } });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Category ops
// ---------------------------------------------------------------------------

export async function listCategoriesOp(userId: string) {
  return prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } });
}

// ---------------------------------------------------------------------------
// Reminder ops
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Occurrence ops
// ---------------------------------------------------------------------------

const eventExceptionInputSchema = z
  .object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideNotes: z.string().max(4000).nullable().optional(),
    overrideStartUtc: z.coerce.date().optional(),
    overrideEndUtc: z.coerce.date().optional(),
    overrideCategoryId: z.string().cuid().nullable().optional(),
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

export async function setEventOccurrenceOp(userId: string, eventId: string, occurrence: string, input: unknown) {
  const ev = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!ev || !ev.rrule) throw new CalendarOpError("not-found", "recurring event not found");
  const parsed = eventExceptionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "setEventOccurrence: validation failed", { issues: parsed.error.issues });
  }
  const originalStartUtc = parseOccurrenceDatetime(occurrence);
  return prisma.eventException.upsert({
    where: { eventId_originalStartUtc: { eventId, originalStartUtc } },
    create: { eventId, originalStartUtc, ...parsed.data },
    update: parsed.data,
  });
}

export async function setBigEventOccurrenceOp(userId: string, bigEventId: string, occurrence: string, input: unknown) {
  const be = await prisma.bigEvent.findFirst({ where: { id: bigEventId, userId } });
  if (!be || !be.rrule) throw new CalendarOpError("not-found", "recurring big event not found");
  const parsed = bigEventExceptionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "setBigEventOccurrence: validation failed", { issues: parsed.error.issues });
  }
  const originalDate = parseDateOnly(occurrence);
  return prisma.bigEventException.upsert({
    where: { bigEventId_originalDate: { bigEventId, originalDate } },
    create: { bigEventId, originalDate, ...parsed.data },
    update: parsed.data,
  });
}

export async function setTodoOccurrenceOp(userId: string, todoId: string, occurrence: string, input: unknown) {
  const t = await prisma.todo.findFirst({ where: { id: todoId, userId } });
  if (!t || !t.rrule) throw new CalendarOpError("not-found", "recurring todo not found");
  const parsed = todoExceptionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "setTodoOccurrence: validation failed", { issues: parsed.error.issues });
  }
  const occurrenceDate = parseDateOnly(occurrence);
  return prisma.todoException.upsert({
    where: { todoId_occurrenceDate: { todoId, occurrenceDate } },
    create: { todoId, occurrenceDate, ...parsed.data },
    update: parsed.data,
  });
}

export async function setDueDateOccurrenceOp(userId: string, dueDateId: string, occurrence: string, input: unknown) {
  const dd = await prisma.dueDate.findFirst({ where: { id: dueDateId, userId } });
  if (!dd || !dd.rrule) throw new CalendarOpError("not-found", "recurring due date not found");
  const parsed = dueDateExceptionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarOpError("validation", "setDueDateOccurrence: validation failed", { issues: parsed.error.issues });
  }
  const originalDueAt = parseOccurrenceDatetime(occurrence);
  return prisma.dueDateException.upsert({
    where: { dueDateId_originalDueAt: { dueDateId, originalDueAt } },
    create: { dueDateId, originalDueAt, ...parsed.data },
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
export async function clearBigEventOccurrenceOp(userId: string, bigEventId: string, occurrence: string) {
  const be = await prisma.bigEvent.findFirst({ where: { id: bigEventId, userId } });
  if (!be) throw new CalendarOpError("not-found", "big event not found");
  await prisma.bigEventException.deleteMany({
    where: { bigEventId, originalDate: parseDateOnly(occurrence) },
  });
  return { ok: true as const };
}
export async function clearTodoOccurrenceOp(userId: string, todoId: string, occurrence: string) {
  const t = await prisma.todo.findFirst({ where: { id: todoId, userId } });
  if (!t) throw new CalendarOpError("not-found", "todo not found");
  await prisma.todoException.deleteMany({
    where: { todoId, occurrenceDate: parseDateOnly(occurrence) },
  });
  return { ok: true as const };
}
export async function clearDueDateOccurrenceOp(userId: string, dueDateId: string, occurrence: string) {
  const dd = await prisma.dueDate.findFirst({ where: { id: dueDateId, userId } });
  if (!dd) throw new CalendarOpError("not-found", "due date not found");
  await prisma.dueDateException.deleteMany({
    where: { dueDateId, originalDueAt: parseOccurrenceDatetime(occurrence) },
  });
  return { ok: true as const };
}
