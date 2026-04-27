import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { hasOverlappingEvent } from "@/lib/events";
import { eventUpdateSchema } from "@/schemas/event";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const parsed = eventUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // If we're touching start/end (and event isn't recurring), check overlap.
  if (parsed.data.startUtc || parsed.data.endUtc) {
    const existing = await prisma.event.findFirst({
      where: { id, userId },
      select: { startUtc: true, endUtc: true, rrule: true },
    });
    if (existing && !existing.rrule) {
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
  }
  const result = await prisma.event.updateMany({
    where: { id, userId },
    data: parsed.data,
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const event = await prisma.event.findUnique({ where: { id } });
  return NextResponse.json(event);
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
