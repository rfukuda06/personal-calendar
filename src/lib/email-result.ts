/**
 * Pure guard for SMTP send results, split out of email.ts so it can be
 * unit-tested without importing the Nodemailer transport or the React Email
 * templates (see email-result.test.ts).
 *
 * Nodemailer rejects the promise on hard failures (bad app password, connection
 * refused), but a per-recipient SMTP refusal instead comes back on a resolved
 * promise with the address in `rejected`. Treating "any rejected" or "zero
 * accepted" as a failure is what keeps a broken email setup *loud*: the caller
 * (recordSendOrSkip in send-reminders.ts) then deletes its placeholder row and
 * retries on the next tick instead of silently recording an undelivered
 * reminder as sent — the exact failure mode that hid the Resend outage.
 */
export type SendResult = { accepted?: unknown[]; rejected?: unknown[] };

export function ensureSent(info: SendResult): void {
  const accepted = info.accepted ?? [];
  const rejected = info.rejected ?? [];
  if (accepted.length === 0 || rejected.length > 0) {
    throw new Error(
      `email not accepted by SMTP server (accepted=${accepted.length}, rejected=${rejected.length})`,
    );
  }
}
