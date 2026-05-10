import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { offsetRemindersArraySchema } from "@/schemas/reminder";

/**
 * Per-occurrence overrides for a recurring Event. The parent series is
 * never mutated — instead we upsert a row in EventException keyed by
 * (eventId, originalStartUtc).
 *
 *   PATCH  /api/events/[id]/occurrence  → set/replace overrides for one
 *                                          occurrence (cancelled=false)
 *   DELETE /api/events/[id]/occurrence?originalStartUtc=...
 *                                       → cancel a single occurrence
 *
 * Series-level edits/deletes still go through /api/events/[id] (they delete
 * the parent + cascade the exceptions).
 */

const minuteBoundary = z.coerce.date().transform((d) => {
  const r = new Date(d);
  r.setSeconds(0, 0);
  return r;
});

const patchSchema = z.object({
  originalStartUtc: z.coerce.date(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).nullable().optional(),
  startUtc: minuteBoundary.optional(),
  endUtc: minuteBoundary.optional(),
  // Reminders aren't per-exception in the data model; when present they're
  // applied to the parent series.
  reminders: offsetRemindersArraySchema,
});

type Params = { params: Promise<{ id: string }> };

async function ownsSeries(userId: string, id: string): Promise<boolean> {
  const found = await prisma.event.findFirst({
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
  const { originalStartUtc, title, notes, startUtc, endUtc, reminders } =
    parsed.data;
  if (startUtc && endUtc && endUtc <= startUtc) {
    return NextResponse.json(
      { error: "End must be after start" },
      { status: 400 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const exception = await tx.eventException.upsert({
      where: {
        eventId_originalStartUtc: { eventId: id, originalStartUtc },
      },
      create: {
        eventId: id,
        originalStartUtc,
        cancelled: false,
        overrideTitle: title ?? null,
        overrideNotes: notes ?? null,
        overrideStartUtc: startUtc ?? null,
        overrideEndUtc: endUtc ?? null,
      },
      // Only write override columns the request actually included.
      // Coercing absent fields to null here would clobber prior overrides
      // on the next save (the EventDialog currently sends all fields, but
      // any future caller that PATCHes a subset would otherwise reset
      // unrelated overrides).
      update: {
        cancelled: false,
        ...(title !== undefined && { overrideTitle: title }),
        ...(notes !== undefined && { overrideNotes: notes }),
        ...(startUtc !== undefined && { overrideStartUtc: startUtc }),
        ...(endUtc !== undefined && { overrideEndUtc: endUtc }),
      },
    });
    if (reminders !== undefined) {
      await tx.reminder.deleteMany({ where: { eventId: id } });
      if (reminders.length > 0) {
        await tx.reminder.createMany({
          data: reminders.map((r) => ({
            userId,
            eventId: id,
            offsetMinutes: r.offsetMinutes,
          })),
        });
      }
    }
    return exception;
  });
  return NextResponse.json(result);
}

export async function DELETE(req: Request, { params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const iso = searchParams.get("originalStartUtc");
  if (!iso) {
    return NextResponse.json(
      { error: "Missing ?originalStartUtc" },
      { status: 400 },
    );
  }
  const originalStartUtc = new Date(iso);
  if (isNaN(originalStartUtc.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (!(await ownsSeries(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.eventException.upsert({
    where: { eventId_originalStartUtc: { eventId: id, originalStartUtc } },
    create: { eventId: id, originalStartUtc, cancelled: true },
    update: { cancelled: true },
  });
  return new NextResponse(null, { status: 204 });
}
