import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { todoCreateSchema } from "@/schemas/todo";
import { expandOccurrences, occurrenceId } from "@/lib/recurrence";
import { laTodayISO } from "@/lib/time";

// Cap the rollover window for recurring todos so a daily-forever todo with
// thousands of historical occurrences doesn't all surface at once.
const ROLLOVER_DAYS = 90;

/**
 * GET /api/todos?date=YYYY-MM-DD returns the visible-on-`date` todo list.
 *
 * Rollover only applies to days that have already passed (real today, LA-zone),
 * so a todo from today doesn't appear pre-emptively on tomorrow's list.
 *
 * Non-recurring: dueDate == date OR (dueDate < min(date, today) AND
 *   completedAt is null).
 * Recurring: for each occurrence date in [date - ROLLOVER_DAYS, date + 1day):
 *   - if == date, include it.
 *   - else if occ < min(date, today) AND no TodoCompletion row, include it.
 *   - completion comes from the matching TodoCompletion row (occurrenceDate).
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
  const tomorrow = new Date(date.getTime() + 86400000);
  const windowStart = new Date(date.getTime() - ROLLOVER_DAYS * 86400000);
  // Rollover only kicks in once the next day actually arrives. When viewing
  // a future date, cap the "treat as past" cutoff at today (LA-zone) so a
  // todo from today doesn't pre-emptively appear on tomorrow's list.
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

  // Non-recurring branch (mirrors Phase 8).
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

  // Recurring branch.
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
    // Only expand from max(parent.dueDate, windowStart) — a series can't have
    // occurrences before its own dueDate (DTSTART).
    const expandFrom = s.dueDate > windowStart ? s.dueDate : windowStart;
    const occs = expandOccurrences(s.rrule, s.dueDate, expandFrom, tomorrow);
    for (const occ of occs) {
      const ex = exByOccurrence.get(occ.getTime());
      if (ex?.cancelled) continue;
      const isViewedDay = occ.getTime() === date.getTime();
      if (!isViewedDay) {
        // Past occurrences only roll forward once their day has actually
        // arrived. When viewing a future date, anything on/after today is
        // skipped — it'll appear in its own day's list (or roll later).
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
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  const parsed = todoCreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const created = await prisma.todo.create({
    data: { ...parsed.data, userId },
  });
  return NextResponse.json(created, { status: 201 });
}
