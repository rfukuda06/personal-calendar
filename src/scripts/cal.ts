/**
 * Calendar CLI — thin wrapper over src/lib/calendar-ops.ts. See that file for
 * the actual logic. This file owns argv/stdin parsing and JSON-on-stdout I/O.
 */

import "dotenv/config";
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

function out(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function fail(message: string, extra?: Record<string, unknown>): never {
  process.stderr.write(JSON.stringify({ error: message, ...extra }) + "\n");
  process.exit(1);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function readStdinJson(): Promise<unknown> {
  const raw = await readStdin();
  if (!raw.trim()) fail("expected JSON object on stdin");
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail("invalid JSON on stdin", { detail: String(e) });
  }
}

type Flags = { positional: string[]; named: Record<string, string | true> };

function parseFlags(argv: string[]): Flags {
  const positional: string[] = [];
  const named: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) named[key] = true;
      else {
        named[key] = next;
        i++;
      }
    } else positional.push(a);
  }
  return { positional, named };
}

function requireFlag(flags: Flags, name: string): string {
  const v = flags.named[name];
  if (typeof v !== "string") fail(`missing required --${name}`);
  return v;
}

function reminderTargetFlag(flags: Flags): { kind: "event" | "big-event" | "due-date"; id: string } {
  for (const kind of ["event", "big-event", "due-date"] as const) {
    const id = flags.named[kind];
    if (typeof id === "string") return { kind, id };
  }
  fail("specify --event, --big-event, or --due-date <id>");
}

function exceptionTargetFlag(flags: Flags): { kind: "event" | "big-event" | "todo" | "due-date"; id: string } {
  for (const kind of ["event", "big-event", "todo", "due-date"] as const) {
    const id = flags.named[kind];
    if (typeof id === "string") return { kind, id };
  }
  fail("specify --event, --big-event, --todo, or --due-date <id>");
}

const HELP = `
Calendar CLI. See src/mcp/README.md — this CLI is a fallback; primary access is via the calendar MCP server.

Reads: list-events, list-todos, list-big-events, list-due-dates, list-reminders, list-categories
Writes (JSON stdin): create-event, update-event <id>, create-todo, update-todo <id>,
       create-big-event, update-big-event <id>, create-due-date, update-due-date <id>,
       add-reminder, set-occurrence
Deletes / toggles: delete-event <id>, delete-todo <id>, delete-big-event <id>,
       delete-due-date <id>, remove-reminder <id>,
       complete-todo <id> [--occurrence YYYY-MM-DD], uncomplete-todo <id> [--occurrence YYYY-MM-DD],
       clear-occurrence

Range flags for list-*: --from YYYY-MM-DD --to YYYY-MM-DD (LA local). Default: today through +30 days.
Reminder commands take --event <id> | --big-event <id> | --due-date <id>.
Occurrence commands also accept --todo <id>; --occurrence is YYYY-MM-DD for big-event/todo, YYYY-MM-DDTHH:mm (LA) for event/due-date.
`.trim();

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP + "\n");
    return;
  }
  const flags = parseFlags(argv);
  const userId = await getUserId();

  switch (cmd) {
    case "list-events": {
      const r = await listEventsOp(userId, {
        from: flags.named.from as string | undefined,
        to: flags.named.to as string | undefined,
      });
      return out(r);
    }
    case "create-event":
      return out(await createEventOp(userId, await readStdinJson()));
    case "update-event": {
      const id = flags.positional[1];
      if (!id) fail("usage: update-event <id>");
      return out(await updateEventOp(userId, id, await readStdinJson()));
    }
    case "delete-event": {
      const id = flags.positional[1];
      if (!id) fail("usage: delete-event <id>");
      return out(await deleteEventOp(userId, id));
    }

    case "list-todos":
      return out(await listTodosOp(userId, {
        from: flags.named.from as string | undefined,
        to: flags.named.to as string | undefined,
      }));
    case "create-todo":
      return out(await createTodoOp(userId, await readStdinJson()));
    case "update-todo": {
      const id = flags.positional[1];
      if (!id) fail("usage: update-todo <id>");
      return out(await updateTodoOp(userId, id, await readStdinJson()));
    }
    case "complete-todo": {
      const id = flags.positional[1];
      if (!id) fail("usage: complete-todo <id>");
      return out(await completeTodoOp(userId, id, true, flags.named.occurrence as string | undefined));
    }
    case "uncomplete-todo": {
      const id = flags.positional[1];
      if (!id) fail("usage: uncomplete-todo <id>");
      return out(await completeTodoOp(userId, id, false, flags.named.occurrence as string | undefined));
    }
    case "delete-todo": {
      const id = flags.positional[1];
      if (!id) fail("usage: delete-todo <id>");
      return out(await deleteTodoOp(userId, id));
    }

    case "list-big-events":
      return out(await listBigEventsOp(userId, {
        from: flags.named.from as string | undefined,
        to: flags.named.to as string | undefined,
      }));
    case "create-big-event":
      return out(await createBigEventOp(userId, await readStdinJson()));
    case "update-big-event": {
      const id = flags.positional[1];
      if (!id) fail("usage: update-big-event <id>");
      return out(await updateBigEventOp(userId, id, await readStdinJson()));
    }
    case "delete-big-event": {
      const id = flags.positional[1];
      if (!id) fail("usage: delete-big-event <id>");
      return out(await deleteBigEventOp(userId, id));
    }

    case "list-due-dates":
      return out(await listDueDatesOp(userId, {
        from: flags.named.from as string | undefined,
        to: flags.named.to as string | undefined,
      }));
    case "create-due-date":
      return out(await createDueDateOp(userId, await readStdinJson()));
    case "update-due-date": {
      const id = flags.positional[1];
      if (!id) fail("usage: update-due-date <id>");
      return out(await updateDueDateOp(userId, id, await readStdinJson()));
    }
    case "delete-due-date": {
      const id = flags.positional[1];
      if (!id) fail("usage: delete-due-date <id>");
      return out(await deleteDueDateOp(userId, id));
    }

    case "list-reminders": {
      const { kind, id } = reminderTargetFlag(flags);
      if (kind === "event") return out(await listEventRemindersOp(userId, id));
      if (kind === "big-event") return out(await listBigEventRemindersOp(userId, id));
      return out(await listDueDateRemindersOp(userId, id));
    }
    case "add-reminder": {
      const { kind, id } = reminderTargetFlag(flags);
      const body = (await readStdinJson()) as Record<string, unknown>;
      if (kind === "big-event") {
        const days = body.daysBefore;
        if (typeof days !== "number") fail("expected {daysBefore: number}");
        return out(await addBigEventReminderOp(userId, id, days));
      }
      const offset = body.offsetMinutes;
      if (typeof offset !== "number") fail("expected {offsetMinutes: number}");
      if (kind === "event") return out(await addEventReminderOp(userId, id, offset));
      return out(await addDueDateReminderOp(userId, id, offset));
    }
    case "remove-reminder": {
      const id = flags.positional[1];
      if (!id) fail("usage: remove-reminder <id>");
      return out(await removeReminderOp(userId, id));
    }

    case "list-categories":
      return out(await listCategoriesOp(userId));

    case "set-occurrence": {
      const { kind, id } = exceptionTargetFlag(flags);
      const occ = requireFlag(flags, "occurrence");
      const body = await readStdinJson();
      if (kind === "event") return out(await setEventOccurrenceOp(userId, id, occ, body));
      if (kind === "big-event") return out(await setBigEventOccurrenceOp(userId, id, occ, body));
      if (kind === "todo") return out(await setTodoOccurrenceOp(userId, id, occ, body));
      return out(await setDueDateOccurrenceOp(userId, id, occ, body));
    }
    case "clear-occurrence": {
      const { kind, id } = exceptionTargetFlag(flags);
      const occ = requireFlag(flags, "occurrence");
      if (kind === "event") return out(await clearEventOccurrenceOp(userId, id, occ));
      if (kind === "big-event") return out(await clearBigEventOccurrenceOp(userId, id, occ));
      if (kind === "todo") return out(await clearTodoOccurrenceOp(userId, id, occ));
      return out(await clearDueDateOccurrenceOp(userId, id, occ));
    }

    default:
      fail(`unknown command: ${cmd}. run \`npm run cal -- help\` for usage.`);
  }
}

main()
  .catch((err) => {
    if (err instanceof CalendarOpError) {
      process.stderr.write(
        JSON.stringify({ error: err.message, code: err.code, ...err.detail }) + "\n",
      );
    } else {
      process.stderr.write(JSON.stringify({ error: String(err?.message ?? err) }) + "\n");
    }
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../lib/db");
    await prisma.$disconnect();
  });
