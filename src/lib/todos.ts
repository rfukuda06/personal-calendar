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
