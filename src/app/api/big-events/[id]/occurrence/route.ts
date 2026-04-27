import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";

/**
 * Per-occurrence override for a recurring BigEvent. Mirrors the events
 * /occurrence endpoint.
 *
 *   PATCH  /api/big-events/[id]/occurrence  — set/replace overrides
 *   DELETE /api/big-events/[id]/occurrence?originalDate=YYYY-MM-DD — cancel
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const patchSchema = z.object({
  originalDate: dateOnly,
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).nullable().optional(),
  categoryId: z.string().cuid().nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

async function ownsSeries(userId: string, id: string): Promise<boolean> {
  const found = await prisma.bigEvent.findFirst({
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
  const { originalDate, title, notes, categoryId } = parsed.data;
  const result = await prisma.bigEventException.upsert({
    where: { bigEventId_originalDate: { bigEventId: id, originalDate } },
    create: {
      bigEventId: id,
      originalDate,
      cancelled: false,
      overrideTitle: title ?? null,
      overrideNotes: notes ?? null,
      overrideCategoryId: categoryId ?? null,
    },
    update: {
      cancelled: false,
      overrideTitle: title ?? null,
      overrideNotes: notes ?? null,
      overrideCategoryId: categoryId ?? null,
    },
  });
  return NextResponse.json(result);
}

export async function DELETE(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const iso = searchParams.get("originalDate");
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return NextResponse.json(
      { error: "Missing or invalid ?originalDate (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  const originalDate = new Date(`${iso}T00:00:00.000Z`);
  if (!(await ownsSeries(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.bigEventException.upsert({
    where: { bigEventId_originalDate: { bigEventId: id, originalDate } },
    create: { bigEventId: id, originalDate, cancelled: true },
    update: { cancelled: true },
  });
  return new NextResponse(null, { status: 204 });
}
