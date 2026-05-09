import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { hasOverlappingEvent } from "@/lib/events";
import { eventUpdateSchema } from "@/schemas/event";
import { computeSeriesEndUtc } from "@/lib/recurrence";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const parsed = eventUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // We need the existing row whenever start/end change (overlap check) AND
  // whenever rrule or startUtc change (recompute seriesEndUtc). Fetch once.
  const touchesRecurrence =
    parsed.data.rrule !== undefined || parsed.data.startUtc !== undefined;
  const needsExisting =
    parsed.data.startUtc || parsed.data.endUtc || touchesRecurrence;
  const existing = needsExisting
    ? await prisma.event.findFirst({
        where: { id, userId },
        select: { startUtc: true, endUtc: true, rrule: true },
      })
    : null;
  if ((parsed.data.startUtc || parsed.data.endUtc) && existing && !existing.rrule) {
    const newStart = parsed.data.startUtc ?? existing.startUtc;
    const newEnd = parsed.data.endUtc ?? existing.endUtc;
    const overlap = await hasOverlappingEvent(userId, newStart, newEnd, id);
    if (overlap) {
      return NextResponse.json(
        { error: "This event overlaps another event." },
        { status: 409 },
      );
    }
  }

  // Recompute seriesEndUtc if rrule or startUtc changed. Set to null when
  // rrule is being cleared or already null, since the column is meaningful
  // only for recurring rows.
  const { reminders, ...rest } = parsed.data;
  const data: typeof rest & { seriesEndUtc?: Date | null } = { ...rest };
  if (touchesRecurrence && existing) {
    const nextRrule =
      parsed.data.rrule !== undefined ? parsed.data.rrule : existing.rrule;
    const nextStart = parsed.data.startUtc ?? existing.startUtc;
    data.seriesEndUtc = nextRrule
      ? computeSeriesEndUtc(nextRrule, nextStart)
      : null;
  }
  // Reminders: replace-the-list semantics. When the client omits the field
  // we leave existing rows alone; when present we delete + recreate inside
  // one transaction so a partial failure can't leave a half-updated set.
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.event.updateMany({
      where: { id, userId },
      data,
    });
    if (result.count === 0) return null;
    if (reminders !== undefined) {
      await tx.reminder.deleteMany({ where: { eventId: id } });
      if (reminders.length > 0) {
        await tx.reminder.createMany({
          data: reminders.map((r) => ({
            userId,
            eventId: id,
            offsetMinutes: r.offsetMinutes,
          })),
        });
      }
    }
    return tx.event.findUnique({ where: { id } });
  });
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const result = await prisma.event.deleteMany({ where: { id, userId } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
