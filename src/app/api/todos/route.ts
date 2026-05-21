import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { resolveTodosForDay } from "@/lib/todos";
import { prisma } from "@/lib/db";
import { todoCreateSchema } from "@/schemas/todo";

/**
 * GET /api/todos?date=YYYY-MM-DD returns the visible-on-`date` todo list.
 * The rollover semantics live in resolveTodosForDay so the digest email
 * and the day view share one implementation.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json(
      { error: "Missing or invalid ?date (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  const date = new Date(`${dateParam}T00:00:00.000Z`);
  const todos = await resolveTodosForDay(userId, date);
  return NextResponse.json(todos);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  const parsed = todoCreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const created = await prisma.todo.create({
    data: { ...parsed.data, userId },
  });
  return NextResponse.json(created, { status: 201 });
}
