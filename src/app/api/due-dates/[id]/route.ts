import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { TZ } from "@/lib/time";
import { dueDateUpdateSchema } from "@/schemas/dueDate";

const MAX_DUE_DATES_PER_DAY = 3;

function laDayUtcRange(dueAt: Date): { start: Date; end: Date } {
  const local = DateTime.fromJSDate(dueAt, { zone: "utc" }).setZone(TZ);
  const dayStart = local.startOf("day");
  return {
    start: dayStart.toUTC().toJSDate(),
    end: dayStart.plus({ days: 1 }).toUTC().toJSDate(),
  };
}

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const parsed = dueDateUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // Re-check the per-day cap when dueAt is moving and the row will end up
  // non-recurring (recurring rows aren't counted).
  if (parsed.data.dueAt) {
    const existing = await prisma.dueDate.findFirst({
      where: { id, userId },
      select: { rrule: true },
    });
    const finalRrule =
      parsed.data.rrule !== undefined ? parsed.data.rrule : existing?.rrule;
    if (!finalRrule) {
      const { start, end } = laDayUtcRange(parsed.data.dueAt);
      const count = await prisma.dueDate.count({
        where: {
          userId,
          rrule: null,
          dueAt: { gte: start, lt: end },
          NOT: { id },
        },
      });
      if (count >= MAX_DUE_DATES_PER_DAY) {
        return NextResponse.json(
          {
            error: `You can have at most ${MAX_DUE_DATES_PER_DAY} due dates on the same day.`,
          },
          { status: 409 },
        );
      }
    }
  }
  const { reminders, ...data } = parsed.data;
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.dueDate.updateMany({
      where: { id, userId },
      data,
    });
    if (result.count === 0) return null;
    if (reminders !== undefined) {
      await tx.reminder.deleteMany({ where: { dueDateId: id } });
      if (reminders.length > 0) {
        await tx.reminder.createMany({
          data: reminders.map((r) => ({
            userId,
            dueDateId: id,
            offsetMinutes: r.offsetMinutes,
          })),
        });
      }
    }
    return tx.dueDate.findUnique({ where: { id } });
  });
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const result = await prisma.dueDate.deleteMany({ where: { id, userId } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
