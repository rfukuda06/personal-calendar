import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { dueDateCreateSchema } from "@/schemas/dueDate";
import { expandOccurrences, occurrenceId } from "@/lib/recurrence";

/**
 * Wire format mirrors events: each item carries `id` (synthetic for
 * occurrences, real cuid for singletons), `seriesId`, `isOccurrence`, and
 * `originalDueAt` so the client can target a specific occurrence.
 */

export async function GET(req: Request) {
  const userId = await requireUserId();
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  if (!fromParam || !toParam) {
    return NextResponse.json(
      { error: "Missing ?from and ?to (ISO datetimes)" },
      { status: 400 },
    );
  }
  const from = new Date(fromParam);
  const to = new Date(toParam);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const singles = await prisma.dueDate.findMany({
    where: {
      userId,
      rrule: null,
      dueAt: { gte: from, lt: to },
    },
    orderBy: { dueAt: "asc" },
    include: { reminders: { select: { offsetMinutes: true } } },
  });

  const series = await prisma.dueDate.findMany({
    where: { userId, rrule: { not: null } },
    include: {
      exceptions: true,
      reminders: { select: { offsetMinutes: true } },
    },
  });

  type Wire = {
    id: string;
    seriesId: string;
    title: string;
    dueAt: Date;
    categoryId: string | null;
    rrule: string | null;
    isOccurrence: boolean;
    originalDueAt: Date | null;
    reminders: { offsetMinutes: number }[];
  };

  const expanded: Wire[] = [];
  for (const s of series) {
    if (!s.rrule) continue;
    const exByOriginal = new Map(
      s.exceptions.map((e) => [e.originalDueAt.getTime(), e]),
    );
    const occs = expandOccurrences(s.rrule, s.dueAt, from, to);
    for (const occ of occs) {
      const ex = exByOriginal.get(occ.getTime());
      if (ex?.cancelled) continue;
      const dueAt = ex?.overrideDueAt ?? occ;
      if (dueAt < from || dueAt >= to) continue;
      expanded.push({
        id: occurrenceId(s.id, occ),
        seriesId: s.id,
        title: ex?.overrideTitle ?? s.title,
        dueAt,
        categoryId:
          ex?.overrideCategoryId !== undefined && ex.overrideCategoryId !== null
            ? ex.overrideCategoryId
            : s.categoryId,
        rrule: s.rrule,
        isOccurrence: true,
        originalDueAt: occ,
        reminders: s.reminders.map((r) => ({
          offsetMinutes: r.offsetMinutes ?? 0,
        })),
      });
    }
  }

  const out: Wire[] = [
    ...singles.map((s) => ({
      id: s.id,
      seriesId: s.id,
      title: s.title,
      dueAt: s.dueAt,
      categoryId: s.categoryId,
      rrule: null,
      isOccurrence: false,
      originalDueAt: null,
      reminders: s.reminders.map((r) => ({
        offsetMinutes: r.offsetMinutes ?? 0,
      })),
    })),
    ...expanded,
  ];
  out.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  const parsed = dueDateCreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { reminders, ...dueDateData } = parsed.data;
  const created = await prisma.dueDate.create({
    data: {
      ...dueDateData,
      userId,
      reminders: reminders
        ? {
            create: reminders.map((r) => ({
              userId,
              offsetMinutes: r.offsetMinutes,
            })),
          }
        : undefined,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
