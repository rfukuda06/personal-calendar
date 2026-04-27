import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { bigEventCreateSchema } from "@/schemas/bigEvent";
import { expandOccurrences, occurrenceId } from "@/lib/recurrence";

// Query params `from` / `to` are YYYY-MM-DD (inclusive start, exclusive end).
export async function GET(req: Request) {
  const userId = await requireUserId();
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  if (!fromParam || !toParam) {
    return NextResponse.json(
      { error: "Missing ?from and ?to (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  const from = new Date(`${fromParam}T00:00:00.000Z`);
  const to = new Date(`${toParam}T00:00:00.000Z`);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const singles = await prisma.bigEvent.findMany({
    where: { userId, rrule: null, date: { gte: from, lt: to } },
    orderBy: { date: "asc" },
  });

  const series = await prisma.bigEvent.findMany({
    where: { userId, rrule: { not: null } },
    include: { exceptions: true },
  });

  type Wire = {
    id: string;
    seriesId: string;
    title: string;
    notes: string | null;
    date: Date;
    categoryId: string | null;
    rrule: string | null;
    isOccurrence: boolean;
    originalDate: Date | null;
  };

  const expanded: Wire[] = [];
  for (const s of series) {
    if (!s.rrule) continue;
    const exByOriginal = new Map(
      s.exceptions.map((e) => [e.originalDate.getTime(), e]),
    );
    const occs = expandOccurrences(s.rrule, s.date, from, to);
    for (const d of occs) {
      const ex = exByOriginal.get(d.getTime());
      if (ex?.cancelled) continue;
      expanded.push({
        id: occurrenceId(s.id, d),
        seriesId: s.id,
        title: ex?.overrideTitle ?? s.title,
        notes: ex?.overrideNotes ?? s.notes,
        date: d,
        categoryId:
          ex?.overrideCategoryId !== undefined && ex.overrideCategoryId !== null
            ? ex.overrideCategoryId
            : s.categoryId,
        rrule: s.rrule,
        isOccurrence: true,
        originalDate: d,
      });
    }
  }

  const out: Wire[] = [
    ...singles.map((b) => ({
      id: b.id,
      seriesId: b.id,
      title: b.title,
      notes: b.notes,
      date: b.date,
      categoryId: b.categoryId,
      rrule: null,
      isOccurrence: false,
      originalDate: null,
    })),
    ...expanded,
  ];
  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  const parsed = bigEventCreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const created = await prisma.bigEvent.create({
    data: { ...parsed.data, userId },
  });
  return NextResponse.json(created, { status: 201 });
}
