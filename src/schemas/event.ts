import { z } from "zod";
import { offsetRemindersArraySchema } from "./reminder";

// Truncate to the minute boundary so touching events (end === start) compare
// cleanly. Stored seconds/ms would otherwise drift past the next event's
// start and trigger false "overlap" errors.
const minuteBoundary = z.coerce.date().transform((d) => {
  const rounded = new Date(d);
  rounded.setSeconds(0, 0);
  return rounded;
});

const eventFields = z.object({
  title: z.string().min(1, "Title is required").max(200),
  notes: z.string().max(4000).optional().nullable(),
  startUtc: minuteBoundary,
  endUtc: minuteBoundary,
  categoryId: z.string().cuid().optional().nullable(),
  rrule: z.string().optional().nullable(), // honored starting Phase 9
  // When present, the API replaces all of this event's reminders with this
  // list (delete + insert in a single transaction). When omitted on PATCH,
  // existing reminders are left alone.
  reminders: offsetRemindersArraySchema,
});

export const eventCreateSchema = eventFields.refine(
  (v) => v.endUtc > v.startUtc,
  { message: "End must be after start", path: ["endUtc"] },
);

export const eventUpdateSchema = eventFields
  .partial()
  .refine(
    (v) => !v.startUtc || !v.endUtc || v.endUtc > v.startUtc,
    { message: "End must be after start", path: ["endUtc"] },
  );

export type EventCreate = z.infer<typeof eventCreateSchema>;
export type EventUpdate = z.infer<typeof eventUpdateSchema>;
