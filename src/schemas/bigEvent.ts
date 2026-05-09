import { z } from "zod";
import { daysBeforeRemindersArraySchema } from "./reminder";

// BigEvent (all-day) dates are stored as @db.Date — just the calendar day,
// no time. We accept a "YYYY-MM-DD" string over the wire and coerce to a
// Date at midnight UTC (which is what Prisma stores for @db.Date columns).
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const bigEventFields = z.object({
  title: z.string().min(1, "Title is required").max(200),
  notes: z.string().max(4000).optional().nullable(),
  date: dateOnly,
  categoryId: z.string().cuid().optional().nullable(),
  rrule: z.string().optional().nullable(), // honored starting Phase 9
  reminders: daysBeforeRemindersArraySchema,
});

export const bigEventCreateSchema = bigEventFields;
export const bigEventUpdateSchema = bigEventFields.partial();

export type BigEventCreate = z.infer<typeof bigEventCreateSchema>;
export type BigEventUpdate = z.infer<typeof bigEventUpdateSchema>;
