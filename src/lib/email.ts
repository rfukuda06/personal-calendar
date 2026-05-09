import { Resend } from "resend";
import { render } from "@react-email/render";
import { ReminderEmail } from "@/emails/ReminderEmail";
import { TodoDigestEmail } from "@/emails/TodoDigestEmail";

// Lazy singleton — the cron script and any future API path that wants to
// send a one-off email both go through here. Using a getter avoids crashing
// at import time when RESEND_API_KEY is missing in environments that don't
// actually send (e.g. unit tests, local dev where notifications are off).
let _resend: Resend | null = null;
function client(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    _resend = new Resend(key);
  }
  return _resend;
}

function fromAddress(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set");
  return from;
}

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

export type ReminderEmailInput = {
  to: string;
  title: string;
  whenDisplay: string; // already-formatted LA-zone string ("Fri May 8, 9:30 AM")
  notes?: string | null;
  eventLink: string; // absolute URL
};

export async function sendReminderEmail(input: ReminderEmailInput) {
  const html = await render(
    ReminderEmail({
      title: input.title,
      whenDisplay: input.whenDisplay,
      notes: input.notes ?? null,
      eventLink: input.eventLink,
    }),
  );
  const text = await render(
    ReminderEmail({
      title: input.title,
      whenDisplay: input.whenDisplay,
      notes: input.notes ?? null,
      eventLink: input.eventLink,
    }),
    { plainText: true },
  );
  await client().emails.send({
    from: fromAddress(),
    to: input.to,
    subject: `Reminder: ${input.title} — ${input.whenDisplay}`,
    html,
    text,
  });
}

export type TodoDigestEmailInput = {
  to: string;
  dateDisplay: string; // "Friday, May 8"
  todos: { title: string }[];
};

export async function sendTodoDigestEmail(input: TodoDigestEmailInput) {
  const html = await render(
    TodoDigestEmail({ dateDisplay: input.dateDisplay, todos: input.todos }),
  );
  const text = await render(
    TodoDigestEmail({ dateDisplay: input.dateDisplay, todos: input.todos }),
    { plainText: true },
  );
  await client().emails.send({
    from: fromAddress(),
    to: input.to,
    subject: `You have ${input.todos.length} todo${input.todos.length === 1 ? "" : "s"} today`,
    html,
    text,
  });
}

export { appUrl };
