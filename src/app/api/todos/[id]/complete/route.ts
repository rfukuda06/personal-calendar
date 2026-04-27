import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";

/**
 * Per-occurrence completion for a recurring Todo.
 *
 *   POST   /api/todos/[id]/complete  body { occurrenceDate, completed }
 *
 * Creates or deletes a TodoCompletion row keyed by (todoId, occurrenceDate).
 * Non-recurring todos use PATCH /api/todos/[id] with `completedAt` instead.
 */

const bodySchema = z.object({
  occurrenceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .transform((s) => new Date(`${s}T00:00:00.000Z`)),
  completed: z.boolean(),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { occurrenceDate, completed } = parsed.data;

  const owner = await prisma.todo.findFirst({
    where: { id, userId, rrule: { not: null } },
    select: { id: true },
  });
  if (!owner) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (completed) {
    await prisma.todoCompletion.upsert({
      where: { todoId_occurrenceDate: { todoId: id, occurrenceDate } },
      create: { todoId: id, occurrenceDate, completedAt: new Date() },
      update: { completedAt: new Date() },
    });
  } else {
    await prisma.todoCompletion.deleteMany({
      where: { todoId: id, occurrenceDate },
    });
  }
  return new NextResponse(null, { status: 204 });
}
