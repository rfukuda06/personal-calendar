import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { bigEventUpdateSchema } from "@/schemas/bigEvent";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const parsed = bigEventUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { reminders, ...data } = parsed.data;
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.bigEvent.updateMany({
      where: { id, userId },
      data,
    });
    if (result.count === 0) return null;
    if (reminders !== undefined) {
      await tx.reminder.deleteMany({ where: { bigEventId: id } });
      if (reminders.length > 0) {
        await tx.reminder.createMany({
          data: reminders.map((r) => ({
            userId,
            bigEventId: id,
            daysBefore: r.daysBefore,
          })),
        });
      }
    }
    return tx.bigEvent.findUnique({ where: { id } });
  });
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const result = await prisma.bigEvent.deleteMany({ where: { id, userId } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
