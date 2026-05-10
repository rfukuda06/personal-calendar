import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { computeSeriesEndUtc, withUntil } from "@/lib/recurrence";
import { offsetRemindersArraySchema } from "@/schemas/reminder";

/**
 * "This event and all following" semantics for a recurring Event.
 *
 *   POST /api/events/[id]/split
 *     body { originalStartUtc, action: "edit"|"delete", title?, notes?,
 *            startUtc?, endUtc?, categoryId?, rrule? }
 *
 * Algorithm:
 *   1. Truncate the parent series so it stops just before `originalStartUtc`
 *      (UNTIL = originalStartUtc - 1ms). If the parent's first occurrence is
 *      at or after the split point, the parent is deleted instead.
 *   2. Drop any EventExceptions whose originalStartUtc >= split point — they
 *      belong to occurrences that no longer exist on the parent.
 *   3. For "edit", create a brand-new Event with the supplied fields,
 *      starting at `originalStartUtc` (or the supplied startUtc), and the
 *      supplied rrule. The new series is independent of the old.
 */

const minuteBoundary = z.coerce.date().transform((d) => {
  const r = new Date(d);
  r.setSeconds(0, 0);
  return r;
});

const bodySchema = z.object({
  originalStartUtc: z.coerce.date(),
  action: z.enum(["edit", "delete"]),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).nullable().optional(),
  startUtc: minuteBoundary.optional(),
  endUtc: minuteBoundary.optional(),
  categoryId: z.string().cuid().nullable().optional(),
  rrule: z.string().nullable().optional(),
  // When present, the new (split) series uses these reminders instead of
  // inheriting the parent's. Omit to copy from the parent.
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

  const parent = await prisma.event.findFirst({
    where: { id, userId, rrule: { not: null } },
    // Pull reminders so the new split series inherits them — the parent's
    // truncated rrule keeps reminders for past occurrences, and the new
    // series should keep reminding the user for future ones.
    include: { reminders: { select: { offsetMinutes: true } } },
  });
  if (!parent || !parent.rrule) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (
    data.action === "edit" &&
    data.startUtc &&
    data.endUtc &&
    data.endUtc <= data.startUtc
  ) {
    return NextResponse.json(
      { error: "End must be after start" },
      { status: 400 },
    );
  }

  const splitPoint = data.originalStartUtc;
  const newParentRrule = withUntil(parent.rrule, parent.startUtc, splitPoint);

  // Run the parent truncation + exception cleanup + (optional) new series in
  // one transaction so partial failures don't leave the data inconsistent.
  const result = await prisma.$transaction(async (tx) => {
    if (newParentRrule === null) {
      // No occurrences left on the parent → delete it (cascades exceptions).
      await tx.event.delete({ where: { id: parent.id } });
    } else {
      await tx.event.update({
        where: { id: parent.id },
        data: {
          rrule: newParentRrule,
          seriesEndUtc: computeSeriesEndUtc(newParentRrule, parent.startUtc),
        },
      });
      await tx.eventException.deleteMany({
        where: { eventId: parent.id, originalStartUtc: { gte: splitPoint } },
      });
    }

    if (data.action === "delete") return null;

    const duration =
      parent.endUtc.getTime() - parent.startUtc.getTime();
    const newStart = data.startUtc ?? splitPoint;
    const newEnd =
      data.endUtc ?? new Date(newStart.getTime() + duration);
    const newRrule = data.rrule === undefined ? parent.rrule : data.rrule;
    return tx.event.create({
      data: {
        userId,
        title: data.title ?? parent.title,
        notes: data.notes ?? parent.notes,
        startUtc: newStart,
        endUtc: newEnd,
        categoryId:
          data.categoryId === undefined ? parent.categoryId : data.categoryId,
        rrule: newRrule,
        seriesEndUtc: newRrule ? computeSeriesEndUtc(newRrule, newStart) : null,
        reminders: (() => {
          // User-provided list wins; otherwise copy parent's so the split
          // series keeps reminding for future occurrences.
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
