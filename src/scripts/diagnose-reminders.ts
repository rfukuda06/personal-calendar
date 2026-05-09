/**
 * One-shot diagnostic: dump the DB state the cron job cares about so we can
 * see why a reminder didn't fire. Safe to delete once we're done debugging.
 */
import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  console.log("ENV:");
  console.log("  RESEND_API_KEY:", process.env.RESEND_API_KEY ? "(set)" : "(missing)");
  console.log("  EMAIL_FROM:", process.env.EMAIL_FROM ?? "(missing)");
  console.log("  APP_URL:", process.env.APP_URL ?? "(missing)");
  console.log();

  const users = await prisma.user.findMany({
    select: { id: true, email: true, notificationsEnabled: true },
  });
  console.log("Users:", users);
  console.log();

  const events = await prisma.event.findMany({
    select: {
      id: true,
      title: true,
      startUtc: true,
      endUtc: true,
      rrule: true,
      userId: true,
    },
    orderBy: { startUtc: "desc" },
    take: 5,
  });
  console.log("Most recent 5 events:");
  for (const e of events) console.log(" ", e);
  console.log();

  const reminders = await prisma.reminder.findMany({
    select: {
      id: true,
      eventId: true,
      bigEventId: true,
      dueDateId: true,
      offsetMinutes: true,
      daysBefore: true,
      userId: true,
    },
  });
  console.log("All reminders:");
  for (const r of reminders) console.log(" ", r);
  console.log();

  const sends = await prisma.reminderSend.findMany();
  console.log("All ReminderSend rows:", sends);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect().finally(() => process.exit(1));
});
