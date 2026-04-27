import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { categoryCreateSchema } from "@/schemas/category";

// Capped at the number of preset color swatches we offer in the UI.
const MAX_CATEGORIES = 8;

export async function GET() {
  const userId = await requireUserId();
  const categories = await prisma.category.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(categories);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  const body = categoryCreateSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }
  const count = await prisma.category.count({ where: { userId } });
  if (count >= MAX_CATEGORIES) {
    return NextResponse.json(
      { error: `You can have at most ${MAX_CATEGORIES} categories.` },
      { status: 409 },
    );
  }
  // Each color can belong to at most one category per user.
  const colorTaken = await prisma.category.findFirst({
    where: { userId, color: body.data.color },
    select: { id: true },
  });
  if (colorTaken) {
    return NextResponse.json(
      { error: "That color is already used by another category." },
      { status: 409 },
    );
  }
  try {
    const category = await prisma.category.create({
      data: { ...body.data, userId },
    });
    return NextResponse.json(category, { status: 201 });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A category with that name already exists" },
        { status: 409 },
      );
    }
    throw err;
  }
}
