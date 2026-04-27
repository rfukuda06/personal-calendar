import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";

const minuteBoundary = z.coerce.date().transform((d) => {
  const r = new Date(d);
  r.setSeconds(0, 0);
  return r;
});

const patchSchema = z.object({
  originalDueAt: z.coerce.date(),
  title: z.string().min(1).max(200).optional(),
  dueAt: minuteBoundary.optional(),
  categoryId: z.string().cuid().nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

async function ownsSeries(userId: string, id: string): Promise<boolean> {
  const found = await prisma.dueDate.findFirst({
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
  const { originalDueAt, title, dueAt, categoryId } = parsed.data;
  const result = await prisma.dueDateException.upsert({
    where: {
      dueDateId_originalDueAt: { dueDateId: id, originalDueAt },
    },
    create: {
      dueDateId: id,
      originalDueAt,
      cancelled: false,
      overrideTitle: title ?? null,
      overrideDueAt: dueAt ?? null,
      overrideCategoryId: categoryId ?? null,
    },
    update: {
      cancelled: false,
      overrideTitle: title ?? null,
      overrideDueAt: dueAt ?? null,
      overrideCategoryId: categoryId ?? null,
    },
  });
  return NextResponse.json(result);
}

export async function DELETE(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const iso = searchParams.get("originalDueAt");
  if (!iso) {
    return NextResponse.json(
      { error: "Missing ?originalDueAt" },
      { status: 400 },
    );
  }
  const originalDueAt = new Date(iso);
  if (isNaN(originalDueAt.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (!(await ownsSeries(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.dueDateException.upsert({
    where: { dueDateId_originalDueAt: { dueDateId: id, originalDueAt } },
    create: { dueDateId: id, originalDueAt, cancelled: true },
    update: { cancelled: true },
  });
  return new NextResponse(null, { status: 204 });
}
