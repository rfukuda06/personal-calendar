import { RRule, type Options } from "rrule";

/**
 * Recurrence helpers.
 *
 * We store RRULE strings without a DTSTART line — the parent row already has
 * the start (`Event.startUtc`, `BigEvent.date`, `Todo.dueDate`), so the rule
 * itself is just the "FREQ=...;..." portion. The DB stores everything in UTC
 * (or as a pure date for big-events/todos); this module expands occurrences
 * in UTC accordingly.
 *
 * DST caveat: occurrences are advanced by whole UTC days/weeks/months. For
 * an LA user, a "weekly on Monday at 2pm" recurrence will land on the same
 * absolute UTC instant every week — meaning the wall-clock time can shift by
 * an hour at DST boundaries. Acceptable trade-off for v1; revisit when we
 * teach the editor to emit `DTSTART;TZID=America/Los_Angeles:...`.
 */

/** Build an RRule object from a stored rule string + parent dtstart. */
export function parseRule(rruleStr: string, dtstart: Date): RRule {
  const opts = RRule.parseString(rruleStr) as Partial<Options>;
  return new RRule({ ...opts, dtstart });
}

/** Half-open expansion: returns occurrence start dates in [from, to). */
export function expandOccurrences(
  rruleStr: string,
  dtstart: Date,
  from: Date,
  to: Date,
  hardCap = 500,
): Date[] {
  const rule = parseRule(rruleStr, dtstart);
  // rrule.between(after, before, inc) is by default exclusive on both ends.
  // We pass inc=true and filter to [from, to).
  const all = rule.between(from, to, true);
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const out: Date[] = [];
  for (const d of all) {
    const ms = d.getTime();
    if (ms >= fromMs && ms < toMs) out.push(d);
    if (out.length >= hardCap) break;
  }
  return out;
}

/**
 * Synthetic id used to identify a single recurring occurrence on the wire.
 * Pairs the parent series id with the occurrence's original UTC start.
 */
export function occurrenceId(seriesId: string, originalStartUtc: Date): string {
  return `${seriesId}@${originalStartUtc.toISOString()}`;
}

/**
 * Truncate a stored RRULE so it stops generating occurrences at or after
 * `before`. Drops any existing UNTIL/COUNT and writes UNTIL = before-1ms.
 *
 * Returns null when the truncation would yield zero occurrences (i.e. the
 * caller should delete the parent series instead of updating it). Caller is
 * expected to pass the parent's dtstart so we can detect that case without
 * re-expanding.
 */
export function withUntil(
  rruleStr: string,
  dtstart: Date,
  before: Date,
): string | null {
  if (before.getTime() <= dtstart.getTime()) return null;
  const opts = parseRule(rruleStr, dtstart).origOptions;
  delete opts.count;
  // RRULE UNTIL is inclusive; subtract 1ms so we don't keep an occurrence
  // that lands exactly on the split point.
  opts.until = new Date(before.getTime() - 1);
  // Strip the DTSTART line that RRule.toString() emits — callers store the
  // bare "FREQ=...;..." form and keep dtstart on the parent row.
  const full = new RRule(opts).toString();
  return full
    .replace(/^DTSTART[^\n]*\n?/, "")
    .replace(/^RRULE:/, "");
}

/**
 * Latest possible occurrence start of a series, or null for "no fixed end"
 * (an open-ended FREQ=... rule with no UNTIL/COUNT).
 *
 * Used as a denormalized column on the parent row so the events list query
 * can skip series that have already finished without expanding them. We
 * compute it on every write that touches the rrule.
 *
 *   - UNTIL → the UNTIL itself (cheap path, no enumeration).
 *   - COUNT → enumerate to find the Nth occurrence's start (bounded by COUNT,
 *             so it's safe even on rrules that nominally run forever).
 *   - neither → null (caller treats as "open-ended").
 */
export function computeSeriesEndUtc(
  rruleStr: string,
  dtstart: Date,
): Date | null {
  const rule = parseRule(rruleStr, dtstart);
  const opts = rule.origOptions;
  if (opts.until) return new Date(opts.until);
  if (opts.count && opts.count > 0) {
    const all = rule.all((_, i) => i < opts.count!);
    if (all.length === 0) return null;
    return all[all.length - 1];
  }
  return null;
}

/** Inverse of occurrenceId. Returns null when the input is not synthetic. */
export function parseOccurrenceId(
  id: string,
): { seriesId: string; originalStartUtc: Date } | null {
  const at = id.indexOf("@");
  if (at < 0) return null;
  const seriesId = id.slice(0, at);
  const iso = id.slice(at + 1);
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return { seriesId, originalStartUtc: d };
}
