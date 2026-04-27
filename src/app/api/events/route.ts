import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { hasOverlappingEvent } from "@/lib/events";
import { eventCreateSchema } from "@/schemas/event";
import { expandOccurrences, occurrenceId } from "@/lib/recurrence";

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
  });

  // Recurring series with their exceptions.
  const series = await prisma.event.findMany({
    where: { userId, rrule: { not: null } },
    include: { exceptions: true },
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
  const event = await prisma.event.create({
    data: { ...parsed.data, userId },
  });
  return NextResponse.json(event, { status: 201 });
}
