import { z } from "zod";

// Range — all list_* tools share this.
export const rangeInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("LA-local start date YYYY-MM-DD. Default: today."),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("LA-local end date YYYY-MM-DD (inclusive). Default: today + 30 days."),
});

// Create/update inputs — pass-through to the existing schemas. We model loosely
// here (record of unknown) and let the op-layer schemas do strict validation,
// to avoid duplicating the schema definitions.
const passthrough = z.record(z.string(), z.unknown())
  .describe("See src/schemas/* — same shape the existing CLI accepts on stdin.");

export const createEventInput = passthrough;
export const updateEventInput = z.object({ id: z.string() }).and(passthrough);
export const deleteByIdInput = z.object({ id: z.string() });

export const createTodoInput = passthrough;
export const updateTodoInput = updateEventInput;
export const completeTodoInput = z.object({
  id: z.string(),
  occurrence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Required iff the todo is recurring. YYYY-MM-DD LA-local."),
});

export const createBigEventInput = passthrough;
export const updateBigEventInput = updateEventInput;

export const createDueDateInput = passthrough;
export const updateDueDateInput = updateEventInput;

export const listRemindersInput = z.object({
  target: z.enum(["event", "big-event", "due-date"]),
  id: z.string(),
});

export const addEventReminderInput = z.object({
  eventId: z.string(),
  offsetMinutes: z.number().int().min(0).max(60 * 24 * 365),
});
export const addBigEventReminderInput = z.object({
  bigEventId: z.string(),
  daysBefore: z.number().int().min(0).max(365),
});
export const addDueDateReminderInput = z.object({
  dueDateId: z.string(),
  offsetMinutes: z.number().int().min(0).max(60 * 24 * 365),
});
export const removeReminderInput = z.object({ id: z.string() });

// Occurrence inputs. The body shape varies per target; we model the union
// as 8 distinct MCP tools so each gets a tight schema.
const occDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const occDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const setEventOccurrenceInput = z.object({
  eventId: z.string(),
  occurrence: occDateTime.describe("LA-local datetime matching the original RRULE start."),
  override: z.object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideNotes: z.string().max(4000).nullable().optional(),
    overrideStartUtc: occDateTime.optional(),
    overrideEndUtc: occDateTime.optional(),
  }).refine((v) => Object.keys(v).length > 0, "empty override"),
});

export const setBigEventOccurrenceInput = z.object({
  bigEventId: z.string(),
  occurrence: occDateOnly,
  override: z.object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideNotes: z.string().max(4000).nullable().optional(),
    overrideCategoryId: z.string().nullable().optional(),
  }).refine((v) => Object.keys(v).length > 0, "empty override"),
});

export const setTodoOccurrenceInput = z.object({
  todoId: z.string(),
  occurrence: occDateOnly,
  override: z.object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideNotes: z.string().max(4000).nullable().optional(),
  }).refine((v) => Object.keys(v).length > 0, "empty override"),
});

export const setDueDateOccurrenceInput = z.object({
  dueDateId: z.string(),
  occurrence: occDateTime,
  override: z.object({
    cancelled: z.boolean().optional(),
    overrideTitle: z.string().min(1).max(200).nullable().optional(),
    overrideDueAt: occDateTime.optional(),
    overrideCategoryId: z.string().nullable().optional(),
  }).refine((v) => Object.keys(v).length > 0, "empty override"),
});

export const clearEventOccurrenceInput = z.object({
  eventId: z.string(),
  occurrence: occDateTime,
});
export const clearBigEventOccurrenceInput = z.object({
  bigEventId: z.string(),
  occurrence: occDateOnly,
});
export const clearTodoOccurrenceInput = z.object({
  todoId: z.string(),
  occurrence: occDateOnly,
});
export const clearDueDateOccurrenceInput = z.object({
  dueDateId: z.string(),
  occurrence: occDateTime,
});
