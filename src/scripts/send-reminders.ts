/**
 * Reminder dispatcher. Designed to run once per minute as a Render Cron Job
 * (`npm run reminders:cron`). Picks up every reminder whose fire time falls
 * in the past minute, sends the email via Resend, and writes a ReminderSend
 * row keyed by (reminderId, occurrenceKey) so a duplicate run can't double-
 * send. Same idea for the 12pm-LA todo digest, gated by TodoDigestSend.
 *
 * Time math is in Luxon (America/Los_Angeles for wall-clock decisions like
 * "is it noon yet" or "midnight of the day before"). Reminder fire times for
 * Event/DueDate are pure UTC arithmetic (start - offsetMinutes); BigEvent
 * fire times are derived per-user-LA because the time-of-day is fixed at
 * 22:00 local.
 *
 * Window semantics: we look at reminders whose computed fireAt sits in the
 * half-open interval [now - WINDOW_MS, now]. If the cron job is delayed by
 * more than WINDOW_MS we miss those reminders — that's the trade-off for
 * a polling design. WINDOW_MS is generous (90s) so a slightly slow tick
 * still catches everything.
 */

import "dotenv/config";
import { DateTime } from "luxon";
import { prisma } from "../lib/db";
import { TZ } from "../lib/time";
import { expandOccurrences } from "../lib/recurrence";
import {
  sendReminderEmail,
  sendTodoDigestEmail,
  appUrl,
} from "../lib/email";

const WINDOW_MS = 90 * 1000;
// Anything older than this is "stale" — we'd rather skip than spam after the
// job recovered from a long outage. Matches the plan's stale-window guard.
const STALE_MS = 60 * 60 * 1000;

type WindowDecision = "fire" | "skip" | "stale";

function inWindow(fireAt: Date, now: Date): WindowDecision {
  const delta = now.getTime() - fireAt.getTime();
  if (delta < 0) return "skip"; // future
  if (delta > STALE_MS) return "stale";
  if (delta > WINDOW_MS) return "skip"; // past but outside our minute
  return "fire";
}

function formatLA(d: Date): string {
  // Time first ("9:30 AM, Fri May 8") to match the subject-line preference.
  return DateTime.fromJSDate(d, { zone: "utc" })
    .setZone(TZ)
    .toFormat("h:mm a, ccc LLL d");
}

function formatLADate(d: Date): string {
  // Used for BigEvent (no time-of-day). `d` is midnight UTC of an LA date,
  // so reading it back in UTC keeps the calendar day correct.
  return DateTime.fromJSDate(d, { zone: "utc" }).toFormat("cccc, LLL d");
}

/** LA-zone calendar day (YYYY-MM-DD) of a UTC instant. Used to build the
 *  day-view link in reminder emails. */
function laDateISO(d: Date): string {
  return DateTime.fromJSDate(d, { zone: "utc" }).setZone(TZ).toISODate()!;
}

/** BigEvent.date is stored as midnight UTC of an LA day; format directly in
 *  UTC to recover the YYYY-MM-DD without a timezone shift. */
function bigEventDateISO(d: Date): string {
  return DateTime.fromJSDate(d, { zone: "utc" }).toISODate()!;
}

function dayLink(dateISO: string): string {
  return `${appUrl()}/calendar/day/${dateISO}`;
}

/** UTC fire time for a BigEvent reminder: 22:00 LA on (eventDate - daysBefore). */
function bigEventFireTime(eventDate: Date, daysBefore: number): Date {
  // BigEvent.date is stored as midnight UTC of an LA calendar day. Read it
  // back in UTC to recover the calendar day, then place 22:00 in LA on the
  // (date - daysBefore) day, then convert to UTC for comparison.
  const dayUtc = DateTime.fromJSDate(eventDate, { zone: "utc" });
  const yyyy = dayUtc.toFormat("yyyy-LL-dd");
  return DateTime.fromISO(yyyy, { zone: TZ })
    .minus({ days: daysBefore })
    .set({ hour: 22, minute: 0, second: 0, millisecond: 0 })
    .toUTC()
    .toJSDate();
}

async function recordSendOrSkip(
  reminderId: string,
  occurrenceKey: string,
  send: () => Promise<void>,
): Promise<boolean> {
  // Insert the ReminderSend row first to claim the slot. If insert fails on
  // the unique constraint, another tick already handled this — bail. If the
  // email send then fails, we delete the placeholder row so a later tick can
  // retry.
  try {
    await prisma.reminderSend.create({
      data: { reminderId, occurrenceKey },
    });
  } catch {
    return false;
  }
  try {
    await send();
    return true;
  } catch (err) {
    console.error(`reminder send failed for ${reminderId}@${occurrenceKey}:`, err);
    await prisma.reminderSend
      .deleteMany({ where: { reminderId, occurrenceKey } })
      .catch(() => undefined);
    return false;
  }
}

async function processEventReminders(now: Date) {
  // Pull every reminder attached to a non-recurring event whose start is in
  // the next year (cheap pre-filter). Then check fire time per row.
  // Reminder.userId.notificationsEnabled gates the user upstream.
  const reminders = await prisma.reminder.findMany({
    where: {
      eventId: { not: null },
      offsetMinutes: { not: null },
      user: { notificationsEnabled: true },
      event: { rrule: null },
    },
    include: {
      event: true,
      user: { select: { email: true } },
    },
  });

  for (const r of reminders) {
    if (!r.event || r.offsetMinutes === null) continue;
    const fireAt = new Date(
      r.event.startUtc.getTime() - r.offsetMinutes * 60_000,
    );
    if (inWindow(fireAt, now) !== "fire") continue;
    const occurrenceKey = r.event.startUtc.toISOString();
    const alreadySent = await prisma.reminderSend.findUnique({
      where: {
        reminderId_occurrenceKey: { reminderId: r.id, occurrenceKey },
      },
    });
    if (alreadySent) continue;
    await recordSendOrSkip(r.id, occurrenceKey, () =>
      sendReminderEmail({
        to: r.user.email,
        title: r.event!.title,
        whenDisplay: formatLA(r.event!.startUtc),
        notes: r.event!.notes,
        eventLink: dayLink(laDateISO(r.event!.startUtc)),
      }),
    );
  }
}

async function processRecurringEventReminders(now: Date) {
  // For each recurring event with reminders, expand the RRULE only across a
  // window wide enough to cover the largest offset on any of its reminders.
  const events = await prisma.event.findMany({
    where: {
      rrule: { not: null },
      reminders: { some: { offsetMinutes: { not: null } } },
      user: { notificationsEnabled: true },
    },
    include: {
      reminders: true,
      exceptions: true,
      user: { select: { email: true } },
    },
  });

  for (const ev of events) {
    if (!ev.rrule) continue;
    const offsets = ev.reminders
      .filter((r) => r.offsetMinutes !== null)
      .map((r) => r.offsetMinutes!);
    if (offsets.length === 0) continue;
    const maxOffsetMs = Math.max(...offsets) * 60_000;
    // Expand instances whose start is in [now, now + maxOffset + WINDOW_MS).
    // Subtracting WINDOW_MS on the lower bound covers reminders whose offset
    // is 0 (fire AT start time).
    const from = new Date(now.getTime() - WINDOW_MS);
    const to = new Date(now.getTime() + maxOffsetMs + WINDOW_MS);
    const occStarts = expandOccurrences(ev.rrule, ev.startUtc, from, to);
    const exByOriginal = new Map(
      ev.exceptions.map((e) => [e.originalStartUtc.getTime(), e]),
    );
    for (const occStart of occStarts) {
      const ex = exByOriginal.get(occStart.getTime());
      if (ex?.cancelled) continue;
      const startUtc = ex?.overrideStartUtc ?? occStart;
      const title = ex?.overrideTitle ?? ev.title;
      const notes = ex?.overrideNotes ?? ev.notes;
      for (const r of ev.reminders) {
        if (r.offsetMinutes === null) continue;
        const fireAt = new Date(startUtc.getTime() - r.offsetMinutes * 60_000);
        if (inWindow(fireAt, now) !== "fire") continue;
        const occurrenceKey = startUtc.toISOString();
        const alreadySent = await prisma.reminderSend.findUnique({
          where: {
            reminderId_occurrenceKey: { reminderId: r.id, occurrenceKey },
          },
        });
        if (alreadySent) continue;
        await recordSendOrSkip(r.id, occurrenceKey, () =>
          sendReminderEmail({
            to: ev.user.email,
            title,
            whenDisplay: formatLA(startUtc),
            notes,
            eventLink: dayLink(laDateISO(startUtc)),
          }),
        );
      }
    }
  }
}

async function processDueDateReminders(now: Date) {
  const reminders = await prisma.reminder.findMany({
    where: {
      dueDateId: { not: null },
      offsetMinutes: { not: null },
      user: { notificationsEnabled: true },
      dueDate: { rrule: null },
    },
    include: {
      dueDate: true,
      user: { select: { email: true } },
    },
  });

  for (const r of reminders) {
    if (!r.dueDate || r.offsetMinutes === null) continue;
    const fireAt = new Date(
      r.dueDate.dueAt.getTime() - r.offsetMinutes * 60_000,
    );
    if (inWindow(fireAt, now) !== "fire") continue;
    const occurrenceKey = r.dueDate.dueAt.toISOString();
    const alreadySent = await prisma.reminderSend.findUnique({
      where: {
        reminderId_occurrenceKey: { reminderId: r.id, occurrenceKey },
      },
    });
    if (alreadySent) continue;
    await recordSendOrSkip(r.id, occurrenceKey, () =>
      sendReminderEmail({
        to: r.user.email,
        title: r.dueDate!.title,
        whenDisplay: formatLA(r.dueDate!.dueAt),
        notes: null,
        eventLink: dayLink(laDateISO(r.dueDate!.dueAt)),
      }),
    );
  }
}

async function processRecurringDueDateReminders(now: Date) {
  const dueDates = await prisma.dueDate.findMany({
    where: {
      rrule: { not: null },
      reminders: { some: { offsetMinutes: { not: null } } },
      user: { notificationsEnabled: true },
    },
    include: {
      reminders: true,
      exceptions: true,
      user: { select: { email: true } },
    },
  });

  for (const dd of dueDates) {
    if (!dd.rrule) continue;
    const offsets = dd.reminders
      .filter((r) => r.offsetMinutes !== null)
      .map((r) => r.offsetMinutes!);
    if (offsets.length === 0) continue;
    const maxOffsetMs = Math.max(...offsets) * 60_000;
    const from = new Date(now.getTime() - WINDOW_MS);
    const to = new Date(now.getTime() + maxOffsetMs + WINDOW_MS);
    const occs = expandOccurrences(dd.rrule, dd.dueAt, from, to);
    const exByOriginal = new Map(
      dd.exceptions.map((e) => [e.originalDueAt.getTime(), e]),
    );
    for (const occ of occs) {
      const ex = exByOriginal.get(occ.getTime());
      if (ex?.cancelled) continue;
      const dueAt = ex?.overrideDueAt ?? occ;
      const title = ex?.overrideTitle ?? dd.title;
      for (const r of dd.reminders) {
        if (r.offsetMinutes === null) continue;
        const fireAt = new Date(dueAt.getTime() - r.offsetMinutes * 60_000);
        if (inWindow(fireAt, now) !== "fire") continue;
        const occurrenceKey = dueAt.toISOString();
        const alreadySent = await prisma.reminderSend.findUnique({
          where: {
            reminderId_occurrenceKey: { reminderId: r.id, occurrenceKey },
          },
        });
        if (alreadySent) continue;
        await recordSendOrSkip(r.id, occurrenceKey, () =>
          sendReminderEmail({
            to: dd.user.email,
            title,
            whenDisplay: formatLA(dueAt),
            notes: null,
            eventLink: dayLink(laDateISO(dueAt)),
          }),
        );
      }
    }
  }
}

async function processBigEventReminders(now: Date) {
  // Non-recurring big events.
  const reminders = await prisma.reminder.findMany({
    where: {
      bigEventId: { not: null },
      daysBefore: { not: null },
      user: { notificationsEnabled: true },
      bigEvent: { rrule: null },
    },
    include: {
      bigEvent: true,
      user: { select: { email: true } },
    },
  });

  for (const r of reminders) {
    if (!r.bigEvent || r.daysBefore === null) continue;
    const fireAt = bigEventFireTime(r.bigEvent.date, r.daysBefore);
    if (inWindow(fireAt, now) !== "fire") continue;
    const occurrenceKey = r.bigEvent.date.toISOString();
    const alreadySent = await prisma.reminderSend.findUnique({
      where: {
        reminderId_occurrenceKey: { reminderId: r.id, occurrenceKey },
      },
    });
    if (alreadySent) continue;
    await recordSendOrSkip(r.id, occurrenceKey, () =>
      sendReminderEmail({
        to: r.user.email,
        title: r.bigEvent!.title,
        whenDisplay: formatLADate(r.bigEvent!.date),
        notes: r.bigEvent!.notes,
        eventLink: dayLink(bigEventDateISO(r.bigEvent!.date)),
      }),
    );
  }
}

async function processRecurringBigEventReminders(now: Date) {
  const bigEvents = await prisma.bigEvent.findMany({
    where: {
      rrule: { not: null },
      reminders: { some: { daysBefore: { not: null } } },
      user: { notificationsEnabled: true },
    },
    include: {
      reminders: true,
      exceptions: true,
      user: { select: { email: true } },
    },
  });

  for (const be of bigEvents) {
    if (!be.rrule) continue;
    const days = be.reminders
      .filter((r) => r.daysBefore !== null)
      .map((r) => r.daysBefore!);
    if (days.length === 0) continue;
    const maxDays = Math.max(...days);
    // Expand instances whose date is in [now - 1 day, now + maxDays + 1 day].
    // Generous bounds because bigEventFireTime maps date → 22:00 LA on
    // (date - daysBefore), and we want to cover boundary cases cleanly.
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(
      now.getTime() + (maxDays + 2) * 24 * 60 * 60 * 1000,
    );
    const occs = expandOccurrences(be.rrule, be.date, from, to);
    const exByOriginal = new Map(
      be.exceptions.map((e) => [e.originalDate.getTime(), e]),
    );
    for (const occ of occs) {
      const ex = exByOriginal.get(occ.getTime());
      if (ex?.cancelled) continue;
      const title = ex?.overrideTitle ?? be.title;
      const notes = ex?.overrideNotes ?? be.notes;
      for (const r of be.reminders) {
        if (r.daysBefore === null) continue;
        const fireAt = bigEventFireTime(occ, r.daysBefore);
        if (inWindow(fireAt, now) !== "fire") continue;
        const occurrenceKey = occ.toISOString();
        const alreadySent = await prisma.reminderSend.findUnique({
          where: {
            reminderId_occurrenceKey: { reminderId: r.id, occurrenceKey },
          },
        });
        if (alreadySent) continue;
        await recordSendOrSkip(r.id, occurrenceKey, () =>
          sendReminderEmail({
            to: be.user.email,
            title,
            whenDisplay: formatLADate(occ),
            notes,
            eventLink: dayLink(bigEventDateISO(occ)),
          }),
        );
      }
    }
  }
}

async function processTodoDigest(now: Date) {
  // Fire only when the LA wall-clock is in the 12:00 minute. Cron runs every
  // minute so we'll hit this exactly once per day per tick that matches.
  const laNow = DateTime.fromJSDate(now, { zone: "utc" }).setZone(TZ);
  if (laNow.hour !== 12 || laNow.minute !== 0) return;
  const todayLaIso = laNow.toISODate()!;
  const todayUtcMidnight = new Date(`${todayLaIso}T00:00:00.000Z`);

  const users = await prisma.user.findMany({
    where: { notificationsEnabled: true },
    select: { id: true, email: true },
  });

  for (const u of users) {
    const already = await prisma.todoDigestSend.findUnique({
      where: {
        userId_digestDate: { userId: u.id, digestDate: todayUtcMidnight },
      },
    });
    if (already) continue;

    // Non-recurring todos due today, not completed.
    const singleTodos = await prisma.todo.findMany({
      where: {
        userId: u.id,
        rrule: null,
        dueDate: todayUtcMidnight,
        completedAt: null,
      },
      select: { title: true },
    });

    // Recurring todos whose RRULE hits today, with no completion or
    // cancellation override for today.
    const recurringTodos = await prisma.todo.findMany({
      where: { userId: u.id, rrule: { not: null } },
      include: {
        completions: { where: { occurrenceDate: todayUtcMidnight } },
        exceptions: { where: { occurrenceDate: todayUtcMidnight } },
      },
    });
    const recurringHits: { title: string }[] = [];
    for (const t of recurringTodos) {
      if (!t.rrule) continue;
      const tomorrow = new Date(todayUtcMidnight.getTime() + 86_400_000);
      const hits = expandOccurrences(
        t.rrule,
        t.dueDate,
        todayUtcMidnight,
        tomorrow,
      );
      if (hits.length === 0) continue;
      const ex = t.exceptions[0];
      if (ex?.cancelled) continue;
      if (t.completions.length > 0) continue;
      recurringHits.push({ title: ex?.overrideTitle ?? t.title });
    }

    const todos = [...singleTodos, ...recurringHits];
    if (todos.length === 0) continue;

    try {
      await prisma.todoDigestSend.create({
        data: { userId: u.id, digestDate: todayUtcMidnight },
      });
    } catch {
      continue; // raced with another run
    }
    try {
      await sendTodoDigestEmail({
        to: u.email,
        dateDisplay: laNow.toFormat("cccc, LLL d"),
        todos,
      });
    } catch (err) {
      console.error(`todo digest send failed for ${u.id}:`, err);
      await prisma.todoDigestSend
        .deleteMany({
          where: { userId: u.id, digestDate: todayUtcMidnight },
        })
        .catch(() => undefined);
    }
  }
}

async function main() {
  const now = new Date();
  console.log(`[reminders] tick at ${now.toISOString()}`);
  await processEventReminders(now);
  await processRecurringEventReminders(now);
  await processDueDateReminders(now);
  await processRecurringDueDateReminders(now);
  await processBigEventReminders(now);
  await processRecurringBigEventReminders(now);
  await processTodoDigest(now);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect().finally(() => process.exit(1));
});
