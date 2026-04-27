"use client";

import { laDay, laTodayISO, dayRange } from "@/lib/time";
import { DaysView } from "./DaysView";
import { BigEventBar } from "./BigEventBar";
import { DueDateBar } from "./DueDateBar";
import { TodoList } from "./TodoList";

/**
 * Single-day view. Top bar shows the date + the BigEvent all-day row; the
 * right rail shows the day's todos (with rolled-over incomplete items).
 */
export function DayView({ dateISO }: { dateISO: string }) {
  const anchor = laDay(dateISO);
  const { start, end } = dayRange(anchor);
  const isToday = anchor.toISODate() === laTodayISO();
  const prefix = anchor.toFormat("cccc, LLLL"); // "Friday, April"
  const dayNum = anchor.toFormat("d");

  return (
    <div className="flex h-full flex-col">
      {/* Fixed bar height so the today-circle (slightly taller than the
          text it replaces) doesn't grow this section. */}
      <div className="flex h-[34px] items-center gap-2 border-b pl-10 pr-4">
        <span className="text-lg font-bold leading-none text-foreground">
          {prefix}
        </span>
        {isToday ? (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-base font-bold leading-none text-primary-foreground">
            {dayNum}
          </span>
        ) : (
          <span className="text-lg font-bold leading-none text-foreground">
            {dayNum}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <DaysView
            days={[anchor]}
            scrollKey={dateISO}
            rangeStart={start}
            rangeEnd={end}
            showDayLabels={false}
            allDayRow={
              <BigEventBar
                days={[anchor]}
                rangeStart={start}
                rangeEnd={end}
              />
            }
            bottomRow={
              <DueDateBar
                days={[anchor]}
                rangeStart={start}
                rangeEnd={end}
                size="md"
              />
            }
          />
        </div>

        <TodoList dateISO={dateISO} />
      </div>
    </div>
  );
}
