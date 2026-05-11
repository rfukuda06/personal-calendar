import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CalendarOpError,
  getUserId,
  listEventsOp,
  createEventOp,
  updateEventOp,
  deleteEventOp,
  listTodosOp,
  createTodoOp,
  updateTodoOp,
  completeTodoOp,
  deleteTodoOp,
  listBigEventsOp,
  createBigEventOp,
  updateBigEventOp,
  deleteBigEventOp,
  listDueDatesOp,
  createDueDateOp,
  updateDueDateOp,
  deleteDueDateOp,
  listCategoriesOp,
  listEventRemindersOp,
  listBigEventRemindersOp,
  listDueDateRemindersOp,
  addEventReminderOp,
  addBigEventReminderOp,
  addDueDateReminderOp,
  removeReminderOp,
  setEventOccurrenceOp,
  setBigEventOccurrenceOp,
  setTodoOccurrenceOp,
  setDueDateOccurrenceOp,
  clearEventOccurrenceOp,
  clearBigEventOccurrenceOp,
  clearTodoOccurrenceOp,
  clearDueDateOccurrenceOp,
} from "../lib/calendar-ops";
import * as S from "../lib/calendar-ops-schemas";

const server = new McpServer({ name: "calendar", version: "1.0.0" });

/**
 * Wrap an op so its result becomes a valid MCP tool response and any
 * CalendarOpError becomes a structured error.
 */
function wrap<T>(fn: () => Promise<T>) {
  return async () => {
    try {
      const result = await fn();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      if (e instanceof CalendarOpError) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: e.message, code: e.code, ...e.detail }, null, 2),
          }],
        };
      }
      throw e;
    }
  };
}

let userId: string;

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

server.registerTool(
  "list_events",
  {
    description: "List events in an LA-local date range. Recurring series are expanded into occurrences.",
    inputSchema: S.rangeInput.shape,
  },
  (args) => wrap(() => listEventsOp(userId, args))(),
);

server.registerTool(
  "list_todos",
  {
    description: "List todos in a date range. Recurring todos expanded into per-day occurrences.",
    inputSchema: S.rangeInput.shape,
  },
  (args) => wrap(() => listTodosOp(userId, args))(),
);

server.registerTool(
  "list_big_events",
  {
    description: "List all-day events (birthdays, exams) in a date range.",
    inputSchema: S.rangeInput.shape,
  },
  (args) => wrap(() => listBigEventsOp(userId, args))(),
);

server.registerTool(
  "list_due_dates",
  {
    description: "List deadlines in a date range.",
    inputSchema: S.rangeInput.shape,
  },
  (args) => wrap(() => listDueDatesOp(userId, args))(),
);

server.registerTool(
  "list_categories",
  {
    description: "List all categories.",
    inputSchema: {},
  },
  () => wrap(() => listCategoriesOp(userId))(),
);

server.registerTool(
  "list_reminders",
  {
    description: "List reminders attached to one Event/BigEvent/DueDate.",
    inputSchema: S.listRemindersInput.shape,
  },
  (args) => wrap(() => {
    if (args.target === "event") return listEventRemindersOp(userId, args.id);
    if (args.target === "big-event") return listBigEventRemindersOp(userId, args.id);
    return listDueDateRemindersOp(userId, args.id);
  })(),
);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

server.registerTool(
  "create_event",
  {
    description: "Create an event (timed). Body matches eventCreateSchema.",
    inputSchema: { body: z.record(z.string(), z.unknown()) },
  },
  ({ body }) => wrap(() => createEventOp(userId, body))(),
);

server.registerTool(
  "update_event",
  {
    description: "Update an event by id. Partial body.",
    inputSchema: { id: z.string(), body: z.record(z.string(), z.unknown()) },
  },
  ({ id, body }) => wrap(() => updateEventOp(userId, id, body))(),
);

server.registerTool(
  "delete_event",
  {
    description: "Delete an event by id (kills the whole series).",
    inputSchema: S.deleteByIdInput.shape,
  },
  ({ id }) => wrap(() => deleteEventOp(userId, id))(),
);

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

server.registerTool(
  "create_todo",
  {
    description: "Create a todo (daily checkbox). Body matches todoCreateSchema.",
    inputSchema: { body: z.record(z.string(), z.unknown()) },
  },
  ({ body }) => wrap(() => createTodoOp(userId, body))(),
);

server.registerTool(
  "update_todo",
  {
    description: "Update a todo by id.",
    inputSchema: { id: z.string(), body: z.record(z.string(), z.unknown()) },
  },
  ({ id, body }) => wrap(() => updateTodoOp(userId, id, body))(),
);

server.registerTool(
  "complete_todo",
  {
    description: "Mark a todo done. For recurring todos, occurrence required (YYYY-MM-DD).",
    inputSchema: S.completeTodoInput.shape,
  },
  ({ id, occurrence }) => wrap(() => completeTodoOp(userId, id, true, occurrence))(),
);

server.registerTool(
  "uncomplete_todo",
  {
    description: "Unmark a completed todo.",
    inputSchema: S.completeTodoInput.shape,
  },
  ({ id, occurrence }) => wrap(() => completeTodoOp(userId, id, false, occurrence))(),
);

server.registerTool(
  "delete_todo",
  {
    description: "Delete a todo by id.",
    inputSchema: S.deleteByIdInput.shape,
  },
  ({ id }) => wrap(() => deleteTodoOp(userId, id))(),
);

// ---------------------------------------------------------------------------
// Big events
// ---------------------------------------------------------------------------

server.registerTool(
  "create_big_event",
  {
    description: "Create an all-day big event (birthday, exam, etc).",
    inputSchema: { body: z.record(z.string(), z.unknown()) },
  },
  ({ body }) => wrap(() => createBigEventOp(userId, body))(),
);

server.registerTool(
  "update_big_event",
  {
    description: "Update a big event by id.",
    inputSchema: { id: z.string(), body: z.record(z.string(), z.unknown()) },
  },
  ({ id, body }) => wrap(() => updateBigEventOp(userId, id, body))(),
);

server.registerTool(
  "delete_big_event",
  {
    description: "Delete a big event by id.",
    inputSchema: S.deleteByIdInput.shape,
  },
  ({ id }) => wrap(() => deleteBigEventOp(userId, id))(),
);

// ---------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------

server.registerTool(
  "create_due_date",
  {
    description: "Create a deadline.",
    inputSchema: { body: z.record(z.string(), z.unknown()) },
  },
  ({ body }) => wrap(() => createDueDateOp(userId, body))(),
);

server.registerTool(
  "update_due_date",
  {
    description: "Update a deadline by id.",
    inputSchema: { id: z.string(), body: z.record(z.string(), z.unknown()) },
  },
  ({ id, body }) => wrap(() => updateDueDateOp(userId, id, body))(),
);

server.registerTool(
  "delete_due_date",
  {
    description: "Delete a deadline by id.",
    inputSchema: S.deleteByIdInput.shape,
  },
  ({ id }) => wrap(() => deleteDueDateOp(userId, id))(),
);

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

server.registerTool(
  "add_event_reminder",
  {
    description: "Attach a reminder to an Event. offsetMinutes before start.",
    inputSchema: S.addEventReminderInput.shape,
  },
  ({ eventId, offsetMinutes }) => wrap(() => addEventReminderOp(userId, eventId, offsetMinutes))(),
);

server.registerTool(
  "add_big_event_reminder",
  {
    description: "Attach a reminder to a BigEvent. daysBefore the date.",
    inputSchema: S.addBigEventReminderInput.shape,
  },
  ({ bigEventId, daysBefore }) => wrap(() => addBigEventReminderOp(userId, bigEventId, daysBefore))(),
);

server.registerTool(
  "add_due_date_reminder",
  {
    description: "Attach a reminder to a DueDate. offsetMinutes before dueAt.",
    inputSchema: S.addDueDateReminderInput.shape,
  },
  ({ dueDateId, offsetMinutes }) => wrap(() => addDueDateReminderOp(userId, dueDateId, offsetMinutes))(),
);

server.registerTool(
  "remove_reminder",
  {
    description: "Remove a reminder by id.",
    inputSchema: S.removeReminderInput.shape,
  },
  ({ id }) => wrap(() => removeReminderOp(userId, id))(),
);

// ---------------------------------------------------------------------------
// Occurrence overrides — set (4 tools)
// ---------------------------------------------------------------------------

server.registerTool(
  "set_event_occurrence",
  {
    description: "Override one occurrence of a recurring event.",
    inputSchema: S.setEventOccurrenceInput.shape,
  },
  ({ eventId, occurrence, override }) => wrap(() => setEventOccurrenceOp(userId, eventId, occurrence, override))(),
);

server.registerTool(
  "set_big_event_occurrence",
  {
    description: "Override one occurrence of a recurring big event.",
    inputSchema: S.setBigEventOccurrenceInput.shape,
  },
  ({ bigEventId, occurrence, override }) => wrap(() => setBigEventOccurrenceOp(userId, bigEventId, occurrence, override))(),
);

server.registerTool(
  "set_todo_occurrence",
  {
    description: "Override one occurrence of a recurring todo.",
    inputSchema: S.setTodoOccurrenceInput.shape,
  },
  ({ todoId, occurrence, override }) => wrap(() => setTodoOccurrenceOp(userId, todoId, occurrence, override))(),
);

server.registerTool(
  "set_due_date_occurrence",
  {
    description: "Override one occurrence of a recurring deadline.",
    inputSchema: S.setDueDateOccurrenceInput.shape,
  },
  ({ dueDateId, occurrence, override }) => wrap(() => setDueDateOccurrenceOp(userId, dueDateId, occurrence, override))(),
);

// ---------------------------------------------------------------------------
// Occurrence overrides — clear (4 tools)
// ---------------------------------------------------------------------------

server.registerTool(
  "clear_event_occurrence",
  {
    description: "Revert an overridden event occurrence to the series default.",
    inputSchema: S.clearEventOccurrenceInput.shape,
  },
  ({ eventId, occurrence }) => wrap(() => clearEventOccurrenceOp(userId, eventId, occurrence))(),
);

server.registerTool(
  "clear_big_event_occurrence",
  {
    description: "Revert an overridden big-event occurrence.",
    inputSchema: S.clearBigEventOccurrenceInput.shape,
  },
  ({ bigEventId, occurrence }) => wrap(() => clearBigEventOccurrenceOp(userId, bigEventId, occurrence))(),
);

server.registerTool(
  "clear_todo_occurrence",
  {
    description: "Revert an overridden todo occurrence.",
    inputSchema: S.clearTodoOccurrenceInput.shape,
  },
  ({ todoId, occurrence }) => wrap(() => clearTodoOccurrenceOp(userId, todoId, occurrence))(),
);

server.registerTool(
  "clear_due_date_occurrence",
  {
    description: "Revert an overridden deadline occurrence.",
    inputSchema: S.clearDueDateOccurrenceInput.shape,
  },
  ({ dueDateId, occurrence }) => wrap(() => clearDueDateOccurrenceOp(userId, dueDateId, occurrence))(),
);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  userId = await getUserId();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.stack ?? e}\n`);
  process.exit(1);
});
