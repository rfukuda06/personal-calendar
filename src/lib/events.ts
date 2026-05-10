import { prisma } from "@/lib/db";
import {
  expandOccurrences,
  occurrenceId,
} from "@/lib/recurrence";

export type EventWire = {
  id: string;
  seriesId: string;
  title: string;
  notes: string | null;
  startUtc: Date;
  endUtc: Date;
  categoryId: string | null;
  rrule: string | null;
  isOccurrence: boolean;
  originalStartUtc: Date | null;
  reminders: { offsetMinutes: number }[];
};

/**
 * Returns events for `userId` overlapping [from, to). Single rows are passed
 * through as-is; recurring series are expanded to per-occurrence rows with
 * exception overrides applied. Same wire shape as `GET /api/events`, so it
 * can back the API route and a TanStack Query SSR prefetch.
 */
export async function fetchEventsInRange(
  userId: string,
  from: Date,
  to: Date,
): Promise<EventWire[]> {
  const [singles, series] = await Promise.all([
    prisma.event.findMany({
      where: {
        userId,
        rrule: null,
        startUtc: { lt: to },
        endUtc: { gt: from },
      },
      orderBy: { startUtc: "asc" },
      include: { reminders: { select: { offsetMinutes: true } } },
    }),
    prisma.event.findMany({
      where: {
        userId,
        rrule: { not: null },
        OR: [{ seriesEndUtc: null }, { seriesEndUtc: { gte: from } }],
        startUtc: { lt: to },
      },
      include: {
        exceptions: true,
        reminders: { select: { offsetMinutes: true } },
      },
    }),
  ]);

  const expanded: EventWire[] = [];
  for (const s of series) {
    if (!s.rrule) continue;
    const durationMs = s.endUtc.getTime() - s.startUtc.getTime();
    const exByOriginal = new Map(
      s.exceptions.map((e) => [e.originalStartUtc.getTime(), e]),
    );
    const occStarts = expandOccurrences(s.rrule, s.startUtc, from, to);
    for (const occStart of occStarts) {
      const ex = exByOriginal.get(occStart.getTime());
      if (ex?.cancelled) continue;
      const startUtc = ex?.overrideStartUtc ?? occStart;
      const endUtc =
        ex?.overrideEndUtc ?? new Date(occStart.getTime() + durationMs);
      if (endUtc <= from || startUtc >= to) continue;
      expanded.push({
        id: occurrenceId(s.id, occStart),
        seriesId: s.id,
        title: ex?.overrideTitle ?? s.title,
        notes: ex?.overrideNotes ?? s.notes,
        startUtc,
        endUtc,
        categoryId: s.categoryId,
        rrule: s.rrule,
        isOccurrence: true,
        originalStartUtc: occStart,
        reminders: s.reminders.map((r) => ({
          offsetMinutes: r.offsetMinutes ?? 0,
        })),
      });
    }
  }

  const out: EventWire[] = [
    ...singles.map((e) => ({
      id: e.id,
      seriesId: e.id,
      title: e.title,
      notes: e.notes,
      startUtc: e.startUtc,
      endUtc: e.endUtc,
      categoryId: e.categoryId,
      rrule: null,
      isOccurrence: false,
      originalStartUtc: null,
      reminders: e.reminders.map((r) => ({
        offsetMinutes: r.offsetMinutes ?? 0,
      })),
    })),
    ...expanded,
  ];
  out.sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  return out;
}

/**
 * Returns true if the given [startUtc, endUtc) range overlaps any existing
 * non-recurring event for the user, optionally excluding one event id
 * (used on PATCH so an event isn't considered to overlap itself).
 */
export async function hasOverlappingEvent(
  userId: string,
  startUtc: Date,
  endUtc: Date,
  excludeId?: string,
): Promise<boolean> {
  const overlap = await prisma.event.findFirst({
    where: {
      userId,
      rrule: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      startUtc: { lt: endUtc },
      endUtc: { gt: startUtc },
    },
    select: { id: true },
  });
  return !!overlap;
}
