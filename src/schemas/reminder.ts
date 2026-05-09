import { z } from "zod";

// Wire format for reminders attached to Event / DueDate. The cron computes
// fire time from `parent.startUtc - offsetMinutes` (or `dueAt - offsetMinutes`),
// so the schema only needs the offset. Capped at 365 days so a typo can't
// schedule a reminder a decade out.
const MAX_OFFSET_MIN = 60 * 24 * 365;

export const offsetReminderSchema = z.object({
  offsetMinutes: z.number().int().min(0).max(MAX_OFFSET_MIN),
});

// BigEvents only carry "N days before" — fire time is fixed at 22:00 LA on
// (date - daysBefore days). Store the raw days here; the cron does the math.
export const daysBeforeReminderSchema = z.object({
  daysBefore: z.number().int().min(0).max(365),
});

export const offsetRemindersArraySchema = z
  .array(offsetReminderSchema)
  .max(20)
  .optional();

export const daysBeforeRemindersArraySchema = z
  .array(daysBeforeReminderSchema)
  .max(20)
  .optional();

export type OffsetReminder = z.infer<typeof offsetReminderSchema>;
export type DaysBeforeReminder = z.infer<typeof daysBeforeReminderSchema>;
