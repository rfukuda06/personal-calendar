import { z } from "zod";
import { offsetRemindersArraySchema } from "./reminder";

const minuteBoundary = z.coerce.date().transform((d) => {
  const r = new Date(d);
  r.setSeconds(0, 0);
  return r;
});

const dueDateFields = z.object({
  title: z.string().min(1, "Title is required").max(200),
  dueAt: minuteBoundary,
  categoryId: z.string().cuid().optional().nullable(),
  rrule: z.string().optional().nullable(),
  reminders: offsetRemindersArraySchema,
});

export const dueDateCreateSchema = dueDateFields;
export const dueDateUpdateSchema = dueDateFields.partial();

export type DueDateCreate = z.infer<typeof dueDateCreateSchema>;
export type DueDateUpdate = z.infer<typeof dueDateUpdateSchema>;
