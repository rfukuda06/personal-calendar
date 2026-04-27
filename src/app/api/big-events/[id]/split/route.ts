import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { withUntil } from "@/lib/recurrence";

/**
 * "This event and all following" semantics for a recurring BigEvent.
 * Truncates the parent's RRULE before `originalDate`, drops any exceptions
 * at or after the split point, and (for "edit") creates a new BigEvent
 * starting at the split date with the supplied fields.
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const bodySchema = z.object({
  originalDate: dateOnly,
  action: z.enum(["edit", "delete"]),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).nullable().optional(),
  date: dateOnly.optional(),
  categoryId: z.string().cuid().nullable().optional(),
  rrule: z.string().nullable().optional(),
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

  const parent = await prisma.bigEvent.findFirst({
    where: { id, userId, rrule: { not: null } },
  });
  if (!parent || !parent.rrule) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const splitPoint = data.originalDate;
  const newParentRrule = withUntil(parent.rrule, parent.date, splitPoint);

  const result = await prisma.$transaction(async (tx) => {
    if (newParentRrule === null) {
      await tx.bigEvent.delete({ where: { id: parent.id } });
    } else {
      await tx.bigEvent.update({
        where: { id: parent.id },
        data: { rrule: newParentRrule },
      });
      await tx.bigEventException.deleteMany({
        where: { bigEventId: parent.id, originalDate: { gte: splitPoint } },
      });
    }

    if (data.action === "delete") return null;

    return tx.bigEvent.create({
      data: {
        userId,
        title: data.title ?? parent.title,
        notes: data.notes ?? parent.notes,
        date: data.date ?? splitPoint,
        categoryId:
          data.categoryId === undefined ? parent.categoryId : data.categoryId,
        rrule: data.rrule === undefined ? parent.rrule : data.rrule,
      },
    });
  });

  return NextResponse.json(result ?? { ok: true });
}
