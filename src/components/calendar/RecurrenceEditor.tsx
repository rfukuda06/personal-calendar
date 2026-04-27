"use client";

import { RRule, Frequency, Weekday } from "rrule";

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

export function RecurrenceEditor({
  value,
  onChange,
  defaultWeekday,
}: {
  value: string | null;
  onChange: (rule: string | null) => void;
  /**
   * rrule weekday number (Mon=0…Sun=6) of the event being edited. Used as
   * the auto-selected day when the user picks "Week" with no day chosen yet,
   * so weekly rules always land on at least the event's own weekday.
   */
  defaultWeekday?: number;
}) {
  const mode = modeOf(value);
  const weekdays = weekdaysOf(value);

  function setMode(next: Mode) {
    if (next === "weekly" && weekdays.length === 0) {
      // Force at least one day selected — defaults to the event's own
      // weekday so the rule starts in the obvious place.
      const seed = defaultWeekday ?? 0;
      onChange(buildRule("weekly", [seed]));
      return;
    }
    onChange(buildRule(next, weekdays));
  }
  function toggleWeekday(n: number) {
    const set = new Set(weekdays);
    if (set.has(n)) {
      // Don't allow unselecting the last day — weekly with zero days is
      // invalid (the rule would silently fall back to dtstart's weekday).
      if (set.size === 1) return;
      set.delete(n);
    } else {
      set.add(n);
    }
    onChange(buildRule("weekly", [...set].sort()));
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
            const on = weekdays.includes(n);
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
