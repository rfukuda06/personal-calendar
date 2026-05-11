import { prisma } from "./db";
import { DateTime } from "luxon";
import { TZ, fromLocalInputValue } from "./time";
import { computeSeriesEndUtc, expandOccurrences, occurrenceId } from "./recurrence";
import { eventCreateSchema, eventUpdateSchema } from "../schemas/event";
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
