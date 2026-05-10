"use client";

import { useEffect, useState } from "react";
import { XIcon, PlusIcon } from "lucide-react";

/**
 * Number input that lets the user briefly clear the field without snapping
 * back to the parent's last value. We keep a local string draft so that
 * value="0", backspace, "1" actually shows "1" — a plain controlled
 * `value={number}` would force the "0" back into the field the moment the
 * user empties it, and the next keystroke would just append.
 *
 * The parent is only told about valid non-negative integers. Empty or
 * partial input stays local until the user types something parseable or
 * blurs.
 */
function NumberInput({
  value,
  min = 0,
  onChange,
  className,
}: {
  value: number;
  min?: number;
  onChange: (next: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  // Re-sync when the parent's number changes for reasons other than this
  // input (e.g., switching unit, parent reset). Only adopt the parent value
  // when it actually disagrees with what the user has typed.
  useEffect(() => {
    if (Number(draft) !== value) setDraft(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="number"
      min={min}
      value={draft}
      onChange={(e) => {
        const s = e.target.value;
        setDraft(s);
        if (s === "") return; // wait for the user to type something
        const n = Number(s);
        if (Number.isFinite(n) && n >= min) onChange(Math.floor(n));
      }}
      onBlur={() => {
        // Commit empty/invalid as `min` so the row stays valid on submit.
        if (draft === "" || !Number.isFinite(Number(draft))) {
          setDraft(String(min));
          onChange(min);
        }
      }}
      className={className}
    />
  );
}

/**
 * Stackable reminder editor. Two modes:
 *
 *   "offset"     — for Event / DueDate. Each row is a {value, unit} that
 *                  produces an offsetMinutes ("30 minutes before",
 *                  "1 hour before", "2 days before"). Unit is just a UI
 *                  affordance — the wire format is always offsetMinutes.
 *
 *   "daysBefore" — for BigEvent. Each row is a single integer days-before;
 *                  the cron always fires those at 22:00 LA. UI hint says so.
 *
 * The component is purely controlled; the parent owns the array. Empty array
 * = no reminders. Default values (30 min for Event, 6 hours for DueDate, 1
 * day for BigEvent) are seeded by the dialog when creating a new entity, not
 * here — this component never invents data on its own.
 */

type Unit = "minutes" | "hours" | "days";

// Mirrors src/schemas/reminder.ts. Hard cap on reminders per event so a user
// can't pile on 50 entries that all email the same address.
const MAX_REMINDERS = 5;

const UNIT_MINUTES: Record<Unit, number> = {
  minutes: 1,
  hours: 60,
  days: 60 * 24,
};

function offsetToParts(offsetMinutes: number): { value: number; unit: Unit } {
  // Pick the largest unit that divides cleanly. Default to minutes for
  // anything weird so we don't lose precision.
  if (offsetMinutes === 0) return { value: 0, unit: "minutes" };
  if (offsetMinutes % UNIT_MINUTES.days === 0)
    return { value: offsetMinutes / UNIT_MINUTES.days, unit: "days" };
  if (offsetMinutes % UNIT_MINUTES.hours === 0)
    return { value: offsetMinutes / UNIT_MINUTES.hours, unit: "hours" };
  return { value: offsetMinutes, unit: "minutes" };
}

export function OffsetReminderEditor({
  value,
  onChange,
}: {
  value: { offsetMinutes: number }[];
  onChange: (next: { offsetMinutes: number }[]) => void;
}) {
  function setRow(i: number, next: { value: number; unit: Unit }) {
    const offsetMinutes = Math.max(0, Math.floor(next.value)) * UNIT_MINUTES[next.unit];
    const copy = [...value];
    copy[i] = { offsetMinutes };
    onChange(copy);
  }
  function removeRow(i: number) {
    const copy = [...value];
    copy.splice(i, 1);
    onChange(copy);
  }
  function addRow() {
    onChange([...value, { offsetMinutes: 30 }]);
  }

  return (
    <div className="space-y-1">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">No reminders.</p>
      )}
      {value.map((r, i) => {
        const { value: v, unit } = offsetToParts(r.offsetMinutes);
        return (
          <div key={i} className="flex items-center gap-1.5">
            <NumberInput
              value={v}
              onChange={(n) => setRow(i, { value: n, unit })}
              className="w-16 rounded border bg-background px-1.5 py-0.5 text-xs"
            />
            <select
              value={unit}
              onChange={(e) =>
                setRow(i, { value: v, unit: e.target.value as Unit })
              }
              className="rounded border bg-background px-1.5 py-0.5 text-xs"
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
            <span className="text-xs text-muted-foreground">before</span>
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent"
              aria-label="Remove reminder"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        );
      })}
      {value.length < MAX_REMINDERS && (
        <button
          type="button"
          onClick={addRow}
          className="mt-1 flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent"
        >
          <PlusIcon className="size-3" />
          Add reminder
        </button>
      )}
    </div>
  );
}

export function DaysBeforeReminderEditor({
  value,
  onChange,
}: {
  value: { daysBefore: number }[];
  onChange: (next: { daysBefore: number }[]) => void;
}) {
  function setRow(i: number, days: number) {
    const copy = [...value];
    copy[i] = { daysBefore: Math.max(0, Math.floor(days)) };
    onChange(copy);
  }
  function removeRow(i: number) {
    const copy = [...value];
    copy.splice(i, 1);
    onChange(copy);
  }
  function addRow() {
    onChange([...value, { daysBefore: 1 }]);
  }

  return (
    <div className="space-y-1">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">No reminders.</p>
      )}
      {value.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <NumberInput
            value={r.daysBefore}
            onChange={(n) => setRow(i, n)}
            className="w-16 rounded border bg-background px-1.5 py-0.5 text-xs"
          />
          <span className="text-xs text-muted-foreground">days before, at 10:00 PM</span>
          <button
            type="button"
            onClick={() => removeRow(i)}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label="Remove reminder"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
      {value.length < MAX_REMINDERS && (
        <button
          type="button"
          onClick={addRow}
          className="mt-1 flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent"
        >
          <PlusIcon className="size-3" />
          Add reminder
        </button>
      )}
    </div>
  );
}
