"use client";

import { useMemo } from "react";
import { laDay, weekDays, weekRange } from "@/lib/time";
import { DaysView } from "./DaysView";
import { BigEventBar } from "./BigEventBar";
import { DueDateBar } from "./DueDateBar";

export function WeekView({ dateISO }: { dateISO: string }) {
  const anchor = laDay(dateISO);
  const days = useMemo(() => weekDays(anchor), [dateISO]);
  const { start, end } = weekRange(anchor);
  return (
    <DaysView
      days={days}
      scrollKey={dateISO}
      rangeStart={start}
      rangeEnd={end}
      allDayRow={
        <BigEventBar days={days} rangeStart={start} rangeEnd={end} />
      }
      bottomRow={
        <DueDateBar days={days} rangeStart={start} rangeEnd={end} />
      }
    />
  );
}
