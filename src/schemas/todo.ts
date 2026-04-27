import { z } from "zod";

// Todo dueDates are @db.Date — calendar day only. Same encoding pattern as
// BigEvent: accept "YYYY-MM-DD" and store as midnight UTC.
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const todoFields = z.object({
  title: z.string().min(1, "Title is required").max(200),
  notes: z.string().max(4000).optional().nullable(),
  dueDate: dateOnly,
  rrule: z.string().optional().nullable(), // honored starting Phase 9
});

export const todoCreateSchema = todoFields;
// Update can also toggle completion (non-recurring todos only — recurring
// completions go through TodoCompletion rows in Phase 9).
export const todoUpdateSchema = todoFields.partial().extend({
  completedAt: z
    .union([z.string().datetime(), z.null()])
    .optional()
    .transform((v) => (v == null ? v : new Date(v))),
});

export type TodoCreate = z.infer<typeof todoCreateSchema>;
export type TodoUpdate = z.infer<typeof todoUpdateSchema>;
