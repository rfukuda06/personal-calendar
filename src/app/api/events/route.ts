import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { hasOverlappingEvent } from "@/lib/events";
import { eventCreateSchema } from "@/schemas/event";
import {
  computeSeriesEndUtc,
  expandOccurrences,
  occurrenceId,
} from "@/lib/recurrence";

/**
 * Wire format for events returned by GET:
 *   - non-recurring: a row from `Event` plus `isOccurrence: false`.
 *   - recurring occurrence: a synthetic row built from the parent series and
 *     (optionally) an EventException. `isOccurrence: true`,
 *     `originalStartUtc` carries the un-overridden start (the key into the
 *     EventException table). The client uses this to target a single
 *     occurrence on edit/delete.
 */

export async function GET(req: Request) {
  const userId = await requireUserId();
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  if (!fromParam || !toParam) {
    return NextResponse.json(
      { error: "Missing ?from and ?to (ISO datetimes)" },
      { status: 400 },
    );
  }
  const from = new Date(fromParam);
  const to = new Date(toParam);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  // Single events overlapping [from, to).
  const singles = await prisma.event.findMany({
    where: {
      userId,
      rrule: null,
      startUtc: { lt: to },
      endUtc: { gt: from },
    },
    orderBy: { startUtc: "asc" },
    include: { reminders: { select: { offsetMinutes: true } } },
  });

  // Recurring series with their exceptions. Skip series that have already
  // finished (seriesEndUtc < from). seriesEndUtc is null for open-ended rules,
  // so those always pass through. We can't filter the lower bound (startUtc
  // > to) cleanly here because we still need to honor the per-series 500-cap
  // edge case; the bigger win is pruning expired finite series, which this
  // does.
  const series = await prisma.event.findMany({
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
  });

  type Wire = {
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

  const expanded: Wire[] = [];
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
      const endUtc = ex?.overrideEndUtc ?? new Date(occStart.getTime() + durationMs);
      // Skip if the (possibly-overridden) span doesn't actually overlap [from, to).
      if (endUtc <= from || startUtc >= to) continue;
      expanded.push({
        // Synthetic per-occurrence id so React keys, exclude-self filters,
        // and adjacency checks all see each occurrence as its own entity.
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

  const out: Wire[] = [
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
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  const parsed = eventCreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!parsed.data.rrule) {
    const overlap = await hasOverlappingEvent(
      userId,
      parsed.data.startUtc,
      parsed.data.endUtc,
    );
    if (overlap) {
      return NextResponse.json(
        { error: "This event overlaps another event." },
        { status: 409 },
      );
    }
  }
  const seriesEndUtc = parsed.data.rrule
    ? computeSeriesEndUtc(parsed.data.rrule, parsed.data.startUtc)
    : null;
  const { reminders, ...eventData } = parsed.data;
  const event = await prisma.event.create({
    data: {
      ...eventData,
      userId,
      seriesEndUtc,
      reminders: reminders
        ? {
            create: reminders.map((r) => ({
              userId,
              offsetMinutes: r.offsetMinutes,
            })),
          }
        : undefined,
    },
  });
  return NextResponse.json(event, { status: 201 });
}
