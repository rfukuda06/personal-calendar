"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { DateTime } from "luxon";
import { dayRange, laDay, laTodayISO, TZ } from "@/lib/time";
import { DaysView } from "../DaysView";
import { BigEventBar } from "../BigEventBar";
import { DueDateBar } from "../DueDateBar";
import { TodoList } from "../TodoList";
import { EventDialog } from "../EventDialog";

type Tab = "schedule" | "todos";
const TAB_KEY = "mobileDayTab";

/**
 * Phone-only single-day view.
 *
 * Layout: large date bar with prev/next, a Schedule|Todos tab toggle (the
 * desktop right-rail TodoList becomes a full-width tab), the existing time
 * grid + all-day/due-date bars, and a floating "+" that opens an event
 * dialog with sensible defaults. Tab choice persists across day navigation
 * via sessionStorage.
 */
export function MobileDayView({ dateISO }: { dateISO: string }) {
  const anchor = laDay(dateISO);
  const { start, end } = dayRange(anchor);
  const isToday = anchor.toISODate() === laTodayISO();
  const prevISO = anchor.minus({ days: 1 }).toISODate();
  const nextISO = anchor.plus({ days: 1 }).toISODate();
  const weekday = anchor.toFormat("cccc");
  const monthDay = anchor.toFormat("LLLL d");

  const [tab, setTab] = useState<Tab>("schedule");
  // Hydrate from sessionStorage post-mount so the user's last-used tab
  // sticks across day navigation but doesn't break SSR.
  useEffect(() => {
    const stored = sessionStorage.getItem(TAB_KEY);
    if (stored === "schedule" || stored === "todos") setTab(stored);
  }, []);
  function pickTab(next: Tab) {
    setTab(next);
    sessionStorage.setItem(TAB_KEY, next);
  }

  const [fabOpen, setFabOpen] = useState(false);
  const [fabStart, setFabStart] = useState<Date | null>(null);
  const [fabEnd, setFabEnd] = useState<Date | null>(null);
  function openFab() {
    // Default: next whole hour in LA, lasting 1 hour. If the next hour falls
    // on the following day, clamp to start at 8am of the viewed day instead
    // (avoids creating events outside the day the user is looking at).
    const nowLa = DateTime.now().setZone(TZ);
    let s: DateTime;
    if (anchor.hasSame(nowLa, "day")) {
      s = nowLa.plus({ hours: 1 }).startOf("hour");
      if (!s.hasSame(anchor, "day")) s = anchor.set({ hour: 8 });
    } else {
      s = anchor.set({ hour: 9 });
    }
    const e = s.plus({ hours: 1 });
    setFabStart(s.toUTC().toJSDate());
    setFabEnd(e.toUTC().toJSDate());
    setFabOpen(true);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Date bar */}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-3">
        <Link
          href={`/calendar/day/${prevISO}`}
          aria-label="Previous day"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border text-xl hover:bg-accent"
        >
          ←
        </Link>
        <div className="flex min-w-0 flex-1 flex-col items-center text-center leading-tight">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {weekday}
          </span>
          {isToday ? (
            <span className="mt-0.5 inline-flex items-center gap-2">
              <span className="text-xl font-bold">{monthDay}</span>
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {anchor.toFormat("d")}
              </span>
            </span>
          ) : (
            <span className="mt-0.5 text-xl font-bold">{monthDay}</span>
          )}
        </div>
        <Link
          href={`/calendar/day/${nextISO}`}
          aria-label="Next day"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border text-xl hover:bg-accent"
        >
          →
        </Link>
      </div>

      {/* Tab toggle */}
      <div className="border-b px-3 py-2">
        <div className="flex items-center overflow-hidden rounded-md border">
          {(["schedule", "todos"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => pickTab(t)}
                className={`flex-1 px-3 py-2 text-sm font-semibold uppercase tracking-wide transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="relative min-h-0 flex-1">
        {tab === "schedule" ? (
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
        ) : (
          <TodoList dateISO={dateISO} variant="full" />
        )}

        {/* FAB */}
        <button
          type="button"
          onClick={openFab}
          aria-label="New event"
          className="absolute bottom-5 right-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/20 transition-transform active:scale-95"
          style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <PlusIcon className="size-6" />
        </button>

        {fabOpen && fabStart && fabEnd && (
          <EventDialog
            open={fabOpen}
            onOpenChange={(v) => setFabOpen(v)}
            startUtc={fabStart}
            endUtc={fabEnd}
            pickingSide={null}
            onPick={() => {
              // On mobile we don't support click-to-pick on the grid — the
              // dialog's start/end inputs are the only entry point.
            }}
          />
        )}
      </div>
    </div>
  );
}
