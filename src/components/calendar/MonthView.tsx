"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api } from "@/lib/api";
import {
  eventOverlapsDay,
  fromUtc,
  laDay,
  monthGridRange,
  TZ,
} from "@/lib/time";
import type { EventModel } from "./EventDialog";
import type { BigEventModel } from "./BigEventDialog";
import type { DueDateModel } from "./DueDateDialog";

type Category = { id: string; name: string; color: string };

// Caps for what's rendered per month-view cell. Big events aren't capped
// (a day rarely has more than one anyway). Due dates show 2; anything more
// collapses into a "+X more" indicator above the visible chips.
const MAX_TIMED_PER_CELL = 7;
const MAX_DUE_PER_CELL = 2;

export function MonthView({ dateISO }: { dateISO: string }) {
  const anchor = laDay(dateISO);
  const { start, end } = monthGridRange(anchor);
  const month = anchor.month;

  // Build the 6×7 grid of days.
  const cells = useMemo(() => {
    const out: DateTime[] = [];
    let d = start;
    while (d < end) {
      out.push(d);
      d = d.plus({ days: 1 });
    }
    return out;
  }, [dateISO]);

  const { data: events = [] } = useQuery({
    queryKey: ["events", start.toISO(), end.toISO()],
    queryFn: () =>
      api.get<EventModel[]>(
        `/api/events?from=${encodeURIComponent(
          start.toUTC().toISO()!,
        )}&to=${encodeURIComponent(end.toUTC().toISO()!)}`,
      ),
  });

  const { data: bigEvents = [] } = useQuery({
    queryKey: ["big-events", start.toISODate(), end.toISODate()],
    queryFn: () =>
      api.get<BigEventModel[]>(
        `/api/big-events?from=${start.toISODate()}&to=${end.toISODate()}`,
      ),
  });
  const bigEventsByDate = useMemo(() => {
    const out: Record<string, BigEventModel[]> = {};
    for (const b of bigEvents) {
      const key = b.date.slice(0, 10);
      (out[key] ||= []).push(b);
    }
    return out;
  }, [bigEvents]);

  const { data: dueDates = [] } = useQuery({
    queryKey: ["due-dates", start.toUTC().toISO(), end.toUTC().toISO()],
    queryFn: () =>
      api.get<DueDateModel[]>(
        `/api/due-dates?from=${encodeURIComponent(
          start.toUTC().toISO()!,
        )}&to=${encodeURIComponent(end.toUTC().toISO()!)}`,
      ),
  });
  const dueDatesByDate = useMemo(() => {
    const out: Record<string, DueDateModel[]> = {};
    for (const d of dueDates) {
      const localDay = fromUtc(new Date(d.dueAt)).toISODate();
      if (!localDay) continue;
      (out[localDay] ||= []).push(d);
    }
    for (const k of Object.keys(out)) {
      out[k].sort(
        (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
      );
    }
    return out;
  }, [dueDates]);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/categories"),
  });
  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const todayISO = DateTime.now().setZone(TZ).toISODate()!;
  const weekdayLabels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  return (
    <div className="flex h-full flex-col">
      {/* Weekday header row — tight padding so the 6-row grid below claims
          as much vertical space as possible. */}
      <div className="grid grid-cols-7 border-b text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {weekdayLabels.map((w) => (
          <div key={w} className="py-0.5">
            {w}
          </div>
        ))}
      </div>

      {/* Month grid. monthGridRange returns 4–6 weeks depending on the
          calendar month, so the row count is derived from cells (not a
          hardcoded 6) — otherwise short months leave a blank row at the
          bottom. */}
      <div
        className="grid min-h-0 flex-1 grid-cols-7"
        style={{
          gridTemplateRows: `repeat(${cells.length / 7}, minmax(0, 1fr))`,
        }}
      >
        {cells.map((day) => {
          const iso = day.toISODate()!;
          const isToday = iso === todayISO;
          const inMonth = day.month === month;
          const dayBig = bigEventsByDate[iso] ?? [];
          const dayDue = dueDatesByDate[iso] ?? [];
          const dayEvents = events
            .filter((e) =>
              eventOverlapsDay(new Date(e.startUtc), new Date(e.endUtc), day),
            )
            .sort(
              (a, b) =>
                new Date(a.startUtc).getTime() - new Date(b.startUtc).getTime(),
            );
          const bigShown = dayBig;
          const shown = dayEvents.slice(0, MAX_TIMED_PER_CELL);
          const timedOverflow = dayEvents.length - shown.length;
          const dueShown = dayDue.slice(0, MAX_DUE_PER_CELL);
          const dueOverflow = dayDue.length - dueShown.length;

          return (
            <Link
              key={iso}
              href={`/calendar/day/${iso}`}
              className={`flex min-w-0 flex-col overflow-hidden border-b border-r p-1 hover:bg-accent/30 ${
                !inMonth ? "bg-muted/30" : ""
              }`}
            >
              {/* Top row: day number + big-event chips beside it. BigEvents
                  apply to the whole day, so they ride alongside the number;
                  timed events go below. */}
              <div className="flex items-start gap-1">
                {isToday ? (
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                    {day.day}
                  </span>
                ) : (
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      inMonth ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {day.day}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                  {bigShown.map((b) => {
                    return (
                      <div
                        key={b.id}
                        className="w-[90%] overflow-hidden truncate border-2 border-foreground bg-muted px-0.5 py-0 text-center text-xs font-bold leading-tight text-foreground"
                        title={b.title}
                      >
                        {b.title}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-0.5 flex min-h-0 flex-1 flex-col gap-0.5">
                {shown.map((e) => {
                  const cat = e.categoryId ? categoryById[e.categoryId] : null;
                  const color = cat?.color ?? "#6b7280";
                  const startStr = fromUtc(new Date(e.startUtc)).toFormat(
                    "h:mm",
                  );
                  const endStr = fromUtc(new Date(e.endUtc)).toFormat("h:mm");
                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-1 overflow-hidden rounded-sm pl-1.5 pr-0.5 py-0 text-[13px] leading-tight text-white"
                      style={{ backgroundColor: color }}
                      title={`${e.title} — ${startStr}–${endStr}`}
                    >
                      <span className="min-w-0 truncate font-bold">
                        {e.title}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {startStr}–{endStr}
                      </span>
                    </div>
                  );
                })}
                {timedOverflow > 0 && (
                  <span className="text-[11px] font-medium text-black">
                    +{timedOverflow} more
                  </span>
                )}
              </div>
              {/* Due dates pinned at the bottom of the cell. Thin solid bar
                  matching the day-/week-view due-date chip styling. */}
              {dueShown.length > 0 && (
                <div className="mt-auto flex flex-col gap-px pt-0.5">
                  {dueOverflow > 0 && (
                    <span className="text-[11px] font-medium text-black">
                      +{dueOverflow} more
                    </span>
                  )}
                  {dueShown.map((d) => {
                    const time = fromUtc(new Date(d.dueAt)).toFormat("h:mma");
                    return (
                      <div
                        key={d.id}
                        className="flex items-center justify-center gap-1 overflow-hidden bg-foreground px-1 text-[10px] font-bold leading-tight text-background"
                        title={`${time} — ${d.title}`}
                      >
                        <span className="min-w-0 truncate">
                          {d.title}
                        </span>
                        <span className="shrink-0 font-medium tabular-nums opacity-80">
                          {time}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
