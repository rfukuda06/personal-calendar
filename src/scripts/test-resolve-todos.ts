import "dotenv/config";
import "./use-prod-db";
import { prisma } from "../lib/db";
import { resolveTodosForDay } from "../lib/todos";
import { expandOccurrences, occurrenceId } from "../lib/recurrence";
import { laTodayISO } from "../lib/time";

// Frozen snapshot of the GET /api/todos rollover query as it stood
// before extraction. Used purely as an oracle for the parity check
// in this script — deleted alongside this script in the cleanup task.
const ROLLOVER_DAYS = 90;
async function legacyResolve(userId: string, date: Date) {
  const tomorrow = new Date(date.getTime() + 86400000);
  const windowStart = new Date(date.getTime() - ROLLOVER_DAYS * 86400000);
  const todayUtc = new Date(`${laTodayISO()}T00:00:00.000Z`);
  const rolloverCutoff = date < todayUtc ? date : todayUtc;

  type Wire = {
    id: string;
    seriesId: string;
    title: string;
    notes: string | null;
    dueDate: Date;
    completedAt: Date | null;
    rrule: string | null;
    isOccurrence: boolean;
    occurrenceDate: Date | null;
  };

  const singles = await prisma.todo.findMany({
    where: {
      userId,
      rrule: null,
      OR: [
        { dueDate: date },
        { dueDate: { lt: rolloverCutoff }, completedAt: null },
      ],
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });

  const series = await prisma.todo.findMany({
    where: { userId, rrule: { not: null } },
    include: {
      completions: {
        where: { occurrenceDate: { gte: windowStart, lt: tomorrow } },
      },
      exceptions: {
        where: { occurrenceDate: { gte: windowStart, lt: tomorrow } },
      },
    },
  });

  const expanded: Wire[] = [];
  for (const s of series) {
    if (!s.rrule) continue;
    const completedSet = new Set(
      s.completions.map((c) => c.occurrenceDate.getTime()),
    );
    const exByOccurrence = new Map(
      s.exceptions.map((e) => [e.occurrenceDate.getTime(), e]),
    );
    const expandFrom = s.dueDate > windowStart ? s.dueDate : windowStart;
    const occs = expandOccurrences(s.rrule, s.dueDate, expandFrom, tomorrow);
    for (const occ of occs) {
      const ex = exByOccurrence.get(occ.getTime());
      if (ex?.cancelled) continue;
      const isViewedDay = occ.getTime() === date.getTime();
      if (!isViewedDay) {
        if (occ.getTime() >= rolloverCutoff.getTime()) continue;
        if (completedSet.has(occ.getTime())) continue;
      }
      const completion = s.completions.find(
        (c) => c.occurrenceDate.getTime() === occ.getTime(),
      );
      expanded.push({
        id: occurrenceId(s.id, occ),
        seriesId: s.id,
        title: ex?.overrideTitle ?? s.title,
        notes: ex?.overrideNotes ?? s.notes,
        dueDate: occ,
        completedAt: completion?.completedAt ?? null,
        rrule: s.rrule,
        isOccurrence: true,
        occurrenceDate: occ,
      });
    }
  }

  const out: Wire[] = [
    ...singles.map((t) => ({
      id: t.id,
      seriesId: t.id,
      title: t.title,
      notes: t.notes,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      rrule: null,
      isOccurrence: false,
      occurrenceDate: null,
    })),
    ...expanded,
  ];
  out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return out;
}

async function main() {
  const users = await prisma.user.findMany({
    where: { notificationsEnabled: true },
    select: { id: true, email: true },
    take: 5,
  });
  if (users.length === 0) throw new Error("no users with notifications enabled");

  const today = new Date(`${laTodayISO()}T00:00:00.000Z`);
  const yesterday = new Date(today.getTime() - 86400000);
  const dates = [today, yesterday];

  for (const u of users) {
    for (const d of dates) {
      const [expected, actual] = await Promise.all([
        legacyResolve(u.id, d),
        resolveTodosForDay(u.id, d),
      ]);
      const e = JSON.stringify(expected);
      const a = JSON.stringify(actual);
      if (e !== a) {
        console.error(`✗ mismatch for ${u.email} on ${d.toISOString()}`);
        console.error("expected:", e);
        console.error("actual:  ", a);
        throw new Error("parity violation");
      }
      console.log(`✓ ${u.email} @ ${d.toISOString().slice(0, 10)}: ${actual.length} items`);
    }
  }
  await prisma.$disconnect();
  console.log("✓ all parity checks passed");
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect().finally(() => process.exit(1));
});
