import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { fetchEventsInRange, hasOverlappingEvent } from "@/lib/events";
import { eventCreateSchema } from "@/schemas/event";
import { computeSeriesEndUtc } from "@/lib/recurrence";

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

  return NextResponse.json(await fetchEventsInRange(userId, from, to));
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
