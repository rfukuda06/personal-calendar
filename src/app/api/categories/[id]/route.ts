import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { categoryUpdateSchema } from "@/schemas/category";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const body = categoryUpdateSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }
  if (body.data.color) {
    const colorTaken = await prisma.category.findFirst({
      where: { userId, color: body.data.color, NOT: { id } },
      select: { id: true },
    });
    if (colorTaken) {
      return NextResponse.json(
        { error: "That color is already used by another category." },
        { status: 409 },
      );
    }
  }
  try {
    const result = await prisma.category.updateMany({
      where: { id, userId },
      data: body.data,
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const category = await prisma.category.findUnique({ where: { id } });
    return NextResponse.json(category);
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

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const result = await prisma.category.deleteMany({ where: { id, userId } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
