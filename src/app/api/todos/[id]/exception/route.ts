import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";

/**
 * Per-occurrence override for a recurring Todo (TodoException — separate
 * from TodoCompletion, which only tracks done/not-done).
 *
 *   PATCH  /api/todos/[id]/exception  — set/replace overrides
 *   DELETE /api/todos/[id]/exception?occurrenceDate=YYYY-MM-DD — cancel
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const patchSchema = z.object({
  occurrenceDate: dateOnly,
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

async function ownsSeries(userId: string, id: string): Promise<boolean> {
  const found = await prisma.todo.findFirst({
    where: { id, userId, rrule: { not: null } },
    select: { id: true },
  });
  return !!found;
}

export async function PATCH(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!(await ownsSeries(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { occurrenceDate, title, notes } = parsed.data;
  const result = await prisma.todoException.upsert({
    where: { todoId_occurrenceDate: { todoId: id, occurrenceDate } },
    create: {
      todoId: id,
      occurrenceDate,
      cancelled: false,
      overrideTitle: title ?? null,
      overrideNotes: notes ?? null,
    },
    // Only write override columns the request actually included so a
    // partial PATCH (e.g. title only) doesn't reset the prior notes
    // override.
    update: {
      cancelled: false,
      ...(title !== undefined && { overrideTitle: title }),
      ...(notes !== undefined && { overrideNotes: notes }),
    },
  });
  return NextResponse.json(result);
}

export async function DELETE(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const iso = searchParams.get("occurrenceDate");
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return NextResponse.json(
      { error: "Missing or invalid ?occurrenceDate (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  const occurrenceDate = new Date(`${iso}T00:00:00.000Z`);
  if (!(await ownsSeries(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.todoException.upsert({
    where: { todoId_occurrenceDate: { todoId: id, occurrenceDate } },
    create: { todoId: id, occurrenceDate, cancelled: true },
    update: { cancelled: true },
  });
  return new NextResponse(null, { status: 204 });
}
