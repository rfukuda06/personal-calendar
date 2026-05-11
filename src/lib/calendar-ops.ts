import { prisma } from "./db";

/**
 * Errors thrown by op functions. Callers (CLI, MCP) format them appropriately.
 * `code` is a machine-readable kebab-case identifier; `detail` is optional extra context.
 */
export class CalendarOpError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CalendarOpError";
  }
}

const USER_EMAIL = "rfukuda06@gmail.com";

let cachedUserId: string | null = null;

/**
 * Resolve the hardcoded user id. Cached in-process — the MCP server calls this
 * once at startup; the CLI calls it once per invocation (no cache benefit).
 */
export async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const u = await prisma.user.findUnique({
    where: { email: USER_EMAIL },
    select: { id: true },
  });
  if (!u) throw new CalendarOpError("no-user", `no user with email ${USER_EMAIL}`);
  cachedUserId = u.id;
  return cachedUserId;
}

/**
 * Helper to parse YYYY-MM-DD into a UTC midnight Date. Date-only fields are
 * stored as UTC midnight in the DB regardless of locale.
 */
export function parseDateOnly(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new CalendarOpError("bad-date", `expected YYYY-MM-DD, got ${s}`);
  }
  return new Date(`${s}T00:00:00.000Z`);
}
