"use client";

import { RRule, Frequency, Weekday } from "rrule";
import { DateTime } from "luxon";
import { TZ } from "@/lib/time";

/**
 * Small recurrence picker. Outputs an RRULE string (no DTSTART line — the
 * parent row carries that). Inputs the current rule + dtstart so the
 * controls can hydrate from existing data.
 *
 * Supported presets: None, Daily, Weekly (with weekday checkboxes), Monthly
 * (by day-of-month, fixed to the parent's day), Yearly (same calendar day).
 * Anything more exotic still type-checks at the API layer (we accept any
 * RRULE string), it just isn't editable here.
 */

type Mode = "none" | "daily" | "weekly" | "monthly" | "yearly";

const WEEKDAYS: { label: string; weekday: Weekday }[] = [
  { label: "S", weekday: RRule.SU },
  { label: "M", weekday: RRule.MO },
  { label: "T", weekday: RRule.TU },
  { label: "W", weekday: RRule.WE },
  { label: "T", weekday: RRule.TH },
  { label: "F", weekday: RRule.FR },
  { label: "S", weekday: RRule.SA },
];

function weekdayNum(w: Weekday): number {
  // rrule's Weekday.weekday: MO=0..SU=6. For comparison we use the raw value.
  // Wrapping in a function to make intent explicit.
  return (w as { weekday: number }).weekday;
}

function modeOf(rule: string | null | undefined): Mode {
  if (!rule) return "none";
  const opts = RRule.parseString(rule);
  switch (opts.freq) {
    case Frequency.DAILY:
      return "daily";
    case Frequency.WEEKLY:
      return "weekly";
    case Frequency.MONTHLY:
      return "monthly";
    case Frequency.YEARLY:
      return "yearly";
    default:
      return "none";
  }
}

function weekdaysOf(rule: string | null | undefined): number[] {
  if (!rule) return [];
  const opts = RRule.parseString(rule);
  const by = opts.byweekday;
  if (!by) return [];
  const arr = Array.isArray(by) ? by : [by];
  return arr.map((w) => {
    if (typeof w === "number") return w;
    return weekdayNum(w as Weekday);
  });
}

function buildRule(mode: Mode, weekdays: number[]): string | null {
  switch (mode) {
    case "none":
      return null;
    case "daily":
      return new RRule({ freq: RRule.DAILY }).toString().replace(/^DTSTART:[^\n]*\n/, "").replace(/^RRULE:/, "");
    case "weekly": {
      const byweekday = weekdays.length > 0
        ? weekdays.map((n) => new Weekday(n))
        : undefined;
      return new RRule({ freq: RRule.WEEKLY, byweekday })
        .toString()
        .replace(/^DTSTART:[^\n]*\n/, "")
        .replace(/^RRULE:/, "");
    }
    case "monthly":
      return new RRule({ freq: RRule.MONTHLY }).toString().replace(/^DTSTART:[^\n]*\n/, "").replace(/^RRULE:/, "");
    case "yearly":
      return new RRule({ freq: RRule.YEARLY }).toString().replace(/^DTSTART:[^\n]*\n/, "").replace(/^RRULE:/, "");
  }
}

/**
 * Days the dtstart's UTC instant moves forward when expressed in LA. 0 when
 * the LA and UTC calendar days agree; 1 when the LA day is the previous
 * calendar day (UTC has crossed midnight ahead). Used to translate weekday
 * pickers between the LA wall-clock the user thinks in and the UTC weekday
 * rrule actually expands BYDAY against.
 */
function laUtcWeekdayOffset(dtstart: Date | undefined): number {
  if (!dtstart) return 0;
  const utcWd = DateTime.fromJSDate(dtstart, { zone: "utc" }).weekday;
  const laWd = DateTime.fromJSDate(dtstart, { zone: "utc" }).setZone(TZ).weekday;
  return ((utcWd - laWd) % 7 + 7) % 7;
}

export function RecurrenceEditor({
  value,
  onChange,
  defaultWeekday,
  dtstart,
}: {
  value: string | null;
  onChange: (rule: string | null) => void;
  /**
   * rrule weekday number (Mon=0…Sun=6) of the dtstart's LA weekday. Shown as
   * a visual hint — when no explicit BYDAY is set, this checkbox renders as
   * selected so users see which day the weekly rule will land on. The rule
   * itself stays clean (no BYDAY) so rrule defaults to dtstart's UTC
   * weekday, avoiding the LA-vs-UTC mismatch at late hours.
   */
  defaultWeekday?: number;
  /**
   * UTC instant the recurrence anchors on. When provided AND the LA wall-clock
   * date differs from the UTC date (i.e. the user picked a late-evening time),
   * weekdays are translated LA↔UTC so the picker reflects LA days while the
   * stored BYDAY uses the UTC weekdays rrule expects. Omit for date-only
   * anchors (BigEvent / Todo) where no translation is needed.
   */
  dtstart?: Date;
}) {
  const mode = modeOf(value);
  const offset = laUtcWeekdayOffset(dtstart);
  // Translate stored BYDAY (UTC weekdays) → LA weekdays for display.
  const weekdays = weekdaysOf(value).map(
    (utc) => ((utc - offset) % 7 + 7) % 7,
  );
  const showDefault = mode === "weekly" && weekdays.length === 0;

  function emit(la: number[]) {
    const utc = la.map((n) => (n + offset) % 7);
    return buildRule("weekly", utc);
  }

  function setMode(next: Mode) {
    // No BYDAY auto-seed for weekly: without explicit days the rule stays
    // clean and rrule falls back to "every 7 days from dtstart", which
    // preserves the LA wall-clock day correctly. Users can tap weekday
    // checkboxes below to add an explicit BYDAY.
    if (next === "weekly") {
      onChange(emit(weekdays));
      return;
    }
    onChange(buildRule(next, []));
  }
  function toggleWeekday(n: number) {
    // Promote the visual default into the explicit set on first interaction
    // so clicking a different day adds to (rather than replaces) the default.
    const set =
      weekdays.length === 0 && defaultWeekday !== undefined
        ? new Set([defaultWeekday])
        : new Set(weekdays);
    if (set.has(n)) {
      // Don't allow unselecting the last day — weekly with zero days is
      // invalid (the rule would silently fall back to dtstart's weekday).
      if (set.size === 1) return;
      set.delete(n);
    } else {
      set.add(n);
    }
    onChange(emit([...set].sort()));
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["daily", "Day"],
            ["weekly", "Week"],
            ["monthly", "Month"],
            ["yearly", "Year"],
            ["none", "None"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              mode === m
                ? "border-primary ring-1 ring-primary"
                : "hover:bg-accent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "weekly" && (
        <div className="flex gap-1 pt-1">
          {WEEKDAYS.map(({ label, weekday }) => {
            const n = weekdayNum(weekday);
            const on =
              weekdays.includes(n) || (showDefault && n === defaultWeekday);
            return (
              <button
                key={n}
                type="button"
                onClick={() => toggleWeekday(n)}
                className={`size-6 rounded-full border text-[10px] font-bold transition-colors ${
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
                aria-label={`Repeat on weekday ${n}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
