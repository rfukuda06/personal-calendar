import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { withUntil } from "@/lib/recurrence";
import { offsetRemindersArraySchema } from "@/schemas/reminder";

const minuteBoundary = z.coerce.date().transform((d) => {
  const r = new Date(d);
  r.setSeconds(0, 0);
  return r;
});

const bodySchema = z.object({
  originalDueAt: z.coerce.date(),
  action: z.enum(["edit", "delete"]),
  title: z.string().min(1).max(200).optional(),
  dueAt: minuteBoundary.optional(),
  categoryId: z.string().cuid().nullable().optional(),
  rrule: z.string().nullable().optional(),
  reminders: offsetRemindersArraySchema,
});

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const parent = await prisma.dueDate.findFirst({
    where: { id, userId, rrule: { not: null } },
    include: { reminders: { select: { offsetMinutes: true } } },
  });
  if (!parent || !parent.rrule) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const splitPoint = data.originalDueAt;
  const newParentRrule = withUntil(parent.rrule, parent.dueAt, splitPoint);

  const result = await prisma.$transaction(async (tx) => {
    if (newParentRrule === null) {
      await tx.dueDate.delete({ where: { id: parent.id } });
    } else {
      await tx.dueDate.update({
        where: { id: parent.id },
        data: { rrule: newParentRrule },
      });
      await tx.dueDateException.deleteMany({
        where: { dueDateId: parent.id, originalDueAt: { gte: splitPoint } },
      });
    }

    if (data.action === "delete") return null;

    return tx.dueDate.create({
      data: {
        userId,
        title: data.title ?? parent.title,
        dueAt: data.dueAt ?? splitPoint,
        categoryId:
          data.categoryId === undefined ? parent.categoryId : data.categoryId,
        rrule: data.rrule === undefined ? parent.rrule : data.rrule,
        reminders: (() => {
          const list = data.reminders ?? parent.reminders;
          return list.length
            ? {
                create: list.map((r) => ({
                  userId,
                  offsetMinutes: r.offsetMinutes,
                })),
              }
            : undefined;
        })(),
      },
    });
  });

  return NextResponse.json(result ?? { ok: true });
}
