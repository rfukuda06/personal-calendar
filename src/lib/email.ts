import nodemailer, { type Transporter } from "nodemailer";
import { render } from "@react-email/render";
import { ReminderEmail } from "@/emails/ReminderEmail";
import { TodoDigestEmail } from "@/emails/TodoDigestEmail";
import type { DigestTodos } from "@/lib/todos";
import { ensureSent } from "@/lib/email-result";

// Lazy singleton transporter. We send through Gmail SMTP using an App Password
// (requires 2-Step Verification on the account). There is no custom sending
// domain, so nothing can fall out of DNS/verification the way the old Resend
// setup did — see DESIGN_DECISIONS.md #13. The getter avoids building the
// transport at import time when credentials are absent (unit tests, or local
// dev with notifications off).
let _transporter: Transporter | null = null;
function transporter(): Transporter {
  if (!_transporter) {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user) throw new Error("GMAIL_USER is not set");
    if (!pass) throw new Error("GMAIL_APP_PASSWORD is not set");
    _transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }
  return _transporter;
}

function fromAddress(): string {
  const user = process.env.GMAIL_USER;
  if (!user) throw new Error("GMAIL_USER is not set");
  // Gmail rewrites any From that isn't the authenticated account, so the address
  // must be GMAIL_USER; we only dress it with a display name.
  return `Personal Calendar <${user}>`;
}

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

export type ReminderEmailInput = {
  to: string;
  title: string;
  // Already-formatted LA-zone string. For timed events we send time-first
  // ("9:30 AM, Fri May 8"); for BigEvents we send a date-only string. Shown
  // in the body; the subject is just the title.
  whenDisplay: string;
  notes?: string | null;
  eventLink: string; // absolute URL pointing to the day view for this event
};

export async function sendReminderEmail(input: ReminderEmailInput) {
  const html = await render(
    ReminderEmail({
      whenDisplay: input.whenDisplay,
      notes: input.notes ?? null,
      eventLink: input.eventLink,
    }),
  );
  const text = await render(
    ReminderEmail({
      whenDisplay: input.whenDisplay,
      notes: input.notes ?? null,
      eventLink: input.eventLink,
    }),
    { plainText: true },
  );
  const info = await transporter().sendMail({
    from: fromAddress(),
    to: input.to,
    subject: input.title,
    html,
    text,
  });
  ensureSent(info);
}

export type TodoDigestEmailInput = DigestTodos & { to: string };

export async function sendTodoDigestEmail(input: TodoDigestEmailInput) {
  const { today, rolledOver } = input;
  const props = { today, rolledOver };
  const html = await render(TodoDigestEmail(props));
  const text = await render(TodoDigestEmail(props), { plainText: true });
  const count = today.length + rolledOver.length;
  const info = await transporter().sendMail({
    from: fromAddress(),
    to: input.to,
    subject: `${count} todo${count === 1 ? "" : "s"}`,
    html,
    text,
  });
  ensureSent(info);
}

export { appUrl };
