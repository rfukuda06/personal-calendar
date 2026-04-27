"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api } from "@/lib/api";
import {
  eventOverlapsDay,
  eventPositionInDay,
  fromUtc,
  laDay,
} from "@/lib/time";
import {
  EventDialog,
  type EventModel,
  type PickingSide,
} from "./EventDialog";
import { announceEditing, subscribeEditing } from "@/lib/editingBus";

const MIN_MS = 10 * 60 * 1000;

function findAdjacent(
  events: EventModel[],
  time: Date,
  day: DateTime,
  excludeId?: string,
) {
  let prev: EventModel | null = null;
  let next: EventModel | null = null;
  for (const e of events) {
    if (e.id === excludeId) continue;
    if (!eventOverlapsDay(new Date(e.startUtc), new Date(e.endUtc), day))
      continue;
    const s = new Date(e.startUtc).getTime();
    const en = new Date(e.endUtc).getTime();
    if (en <= time.getTime()) {
      if (!prev || en > new Date(prev.endUtc).getTime()) prev = e;
    } else if (s >= time.getTime()) {
      if (!next || s < new Date(next.startUtc).getTime()) next = e;
    }
  }
  return { prev, next };
}

function isInsideEvent(
  events: EventModel[],
  time: Date,
  excludeId?: string,
): boolean {
  const t = time.getTime();
  return events.some((e) => {
    if (e.id === excludeId) return false;
    const s = new Date(e.startUtc).getTime();
    const en = new Date(e.endUtc).getTime();
    return t >= s && t < en;
  });
}

const VISIBLE_START_HOUR = 0;
const VISIBLE_END_HOUR = 24;
const VISIBLE_HOURS = VISIBLE_END_HOUR - VISIBLE_START_HOUR;
const DEFAULT_SCROLL_HOUR = 7;
const SLOT_MINUTES = 10;
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
const SLOT_HEIGHT = 9;
const HOUR_HEIGHT = SLOT_HEIGHT * SLOTS_PER_HOUR;
const TOTAL_SLOTS = VISIBLE_HOURS * SLOTS_PER_HOUR;
const HOURS = Array.from({ length: VISIBLE_HOURS }, (_, i) => VISIBLE_START_HOUR + i);

type Category = { id: string; name: string; color: string };

export function DaysView({
  days,
  scrollKey,
  rangeStart,
  rangeEnd,
  showDayLabels = true,
  allDayRow,
  bottomRow,
}: {
  days: DateTime[];
  scrollKey: string;
  rangeStart: DateTime;
  rangeEnd: DateTime;
  showDayLabels?: boolean;
  allDayRow?: React.ReactNode;
  /** Renders below the scrolling hour grid, pinned to the bottom of the
   *  view. Used for the due-date strip. */
  bottomRow?: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop =
        (DEFAULT_SCROLL_HOUR - VISIBLE_START_HOUR) * HOUR_HEIGHT;
    }
  }, [scrollKey]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventModel | undefined>();
  const [draftStart, setDraftStart] = useState<Date>(new Date());
  const [draftEnd, setDraftEnd] = useState<Date>(new Date());
  const [pickingSide, setPickingSide] = useState<PickingSide>(null);

  const draftStartRef = useRef(draftStart);
  const draftEndRef = useRef(draftEnd);
  draftStartRef.current = draftStart;
  draftEndRef.current = draftEnd;

  const { data: events = [] } = useQuery({
    queryKey: ["events", rangeStart.toISO(), rangeEnd.toISO()],
    queryFn: () =>
      api.get<EventModel[]>(
        `/api/events?from=${encodeURIComponent(
          rangeStart.toUTC().toISO()!,
        )}&to=${encodeURIComponent(rangeEnd.toUTC().toISO()!)}`,
      ),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/categories"),
  });
  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const eventsRef = useRef(events);
  eventsRef.current = events;
  const editingIdRef = useRef<string | undefined>(editingEvent?.id);
  editingIdRef.current = editingEvent?.id;

  const prePickStart = useRef<Date | null>(null);
  const prePickEnd = useRef<Date | null>(null);
  const pickingSideRef = useRef<PickingSide>(pickingSide);
  pickingSideRef.current = pickingSide;

  function enterPicking(side: "start" | "end") {
    prePickStart.current = draftStartRef.current;
    prePickEnd.current = draftEndRef.current;
    setPickingSide(side);
  }
  function cancelPicking() {
    if (prePickStart.current) setDraftStart(prePickStart.current);
    if (prePickEnd.current) setDraftEnd(prePickEnd.current);
    prePickStart.current = null;
    prePickEnd.current = null;
    setPickingSide(null);
  }
  function commitPicking() {
    prePickStart.current = null;
    prePickEnd.current = null;
    setPickingSide(null);
  }

  useEffect(() => {
    if (!pickingSide || !dialogOpen) return;
    const draftDayISO = fromUtc(draftStartRef.current).toISODate();
    if (!draftDayISO) return;
    const col = document.querySelector<HTMLElement>(
      `[data-date="${draftDayISO}"]`,
    );
    if (!col) return;
    const day = laDay(draftDayISO).startOf("day");

    function onMove(ev: PointerEvent) {
      if (!col) return;
      const rect = col.getBoundingClientRect();
      if (
        ev.clientX < rect.left ||
        ev.clientX > rect.right ||
        ev.clientY < rect.top ||
        ev.clientY > rect.bottom
      )
        return;
      const y = ev.clientY - rect.top;
      const slotIdx = Math.max(
        0,
        Math.min(TOTAL_SLOTS, Math.round(y / SLOT_HEIGHT)),
      );
      const time = day.plus({ minutes: slotIdx * SLOT_MINUTES }).toUTC().toJSDate();
      const side = pickingSideRef.current;
      if (!side) return;
      const clamped = computePick(side, day, time);
      if (!clamped) return;
      if (side === "start") setDraftStart(clamped);
      else setDraftEnd(clamped);
    }

    document.addEventListener("pointermove", onMove);
    return () => document.removeEventListener("pointermove", onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickingSide, dialogOpen]);

  useEffect(() => {
    if (!pickingSide) return;
    const id = setTimeout(() => {
      document.addEventListener("click", commitPicking);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", commitPicking);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickingSide]);

  function computePick(
    side: "start" | "end",
    day: DateTime,
    clickedUtc: Date,
  ): Date | null {
    const excludeId = editingEvent?.id;
    if (side === "start") {
      if (isInsideEvent(events, clickedUtc, excludeId)) return null;
      if (clickedUtc.getTime() >= draftEndRef.current.getTime()) return null;
      const { prev } = findAdjacent(
        events,
        draftEndRef.current,
        day,
        excludeId,
      );
      const minStart = prev ? new Date(prev.endUtc).getTime() : 0;
      if (clickedUtc.getTime() < minStart) return null;
      return clickedUtc;
    } else {
      if (clickedUtc.getTime() <= draftStartRef.current.getTime()) return null;
      const { next } = findAdjacent(
        events,
        draftStartRef.current,
        day,
        excludeId,
      );
      const maxEnd = next
        ? new Date(next.startUtc).getTime()
        : Number.POSITIVE_INFINITY;
      if (clickedUtc.getTime() > maxEnd) return null;
      return clickedUtc;
    }
  }

  function handleSlotClick(day: DateTime, hour: number, minute: number) {
    const clickedDT = day.set({ hour, minute });
    const clickedUtc = clickedDT.toUTC().toJSDate();

    if (dialogOpen && pickingSide) {
      const clamped = computePick(pickingSide, day, clickedUtc);
      if (!clamped) return;
      if (pickingSide === "start") setDraftStart(clamped);
      else setDraftEnd(clamped);
      commitPicking();
      return;
    }

    if (dialogOpen) return;

    if (isInsideEvent(events, clickedUtc)) return;
    const { next } = findAdjacent(events, clickedUtc, day);
    if (next) {
      const gap = new Date(next.startUtc).getTime() - clickedUtc.getTime();
      if (gap < MIN_MS) return;
    }
    const endUtc = new Date(clickedUtc.getTime() + MIN_MS);

    setEditingEvent(undefined);
    setDraftStart(clickedUtc);
    setDraftEnd(endUtc);
    setDialogOpen(true);
    prePickStart.current = clickedUtc;
    prePickEnd.current = endUtc;
    setPickingSide("end");
    announceEditing("event");
  }

  function openEdit(ev: EventModel) {
    setEditingEvent(ev);
    setDraftStart(new Date(ev.startUtc));
    setDraftEnd(new Date(ev.endUtc));
    setPickingSide(null);
    setDialogOpen(true);
    announceEditing("event");
  }

  // Cancel our open dialog when a BigEvent or DueDate dialog opens. Notes
  // coexist with all three — they never cancel us.
  useEffect(() => {
    return subscribeEditing((source) => {
      if (source !== "big-event" && source !== "due-date") return;
      if (!dialogOpen) return;
      cancelPicking();
      setDialogOpen(false);
      setEditingEvent(undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen]);

  function handlePick(side: "start" | "end") {
    if (pickingSide === side) {
      cancelPicking();
    } else {
      enterPicking(side);
    }
  }

  function beginDrag(
    side: "start" | "end",
    day: DateTime,
    e: React.PointerEvent<HTMLDivElement>,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const dayCol = e.currentTarget.closest(
      "[data-day-column]",
    ) as HTMLElement | null;
    if (!dayCol) return;
    const rect = dayCol.getBoundingClientRect();
    const dayStart = day.startOf("day");
    const startY = e.clientY;
    let moved = false;

    function onMove(ev: PointerEvent) {
      if (!moved && Math.abs(ev.clientY - startY) > 3) moved = true;
      if (!moved) return;
      const y = ev.clientY - rect.top;
      const slotIdx = Math.max(
        0,
        Math.min(TOTAL_SLOTS, Math.round(y / SLOT_HEIGHT)),
      );
      const newDT = dayStart.plus({ minutes: slotIdx * SLOT_MINUTES });
      const newUtc = newDT.toUTC().toJSDate();
      const excludeId = editingIdRef.current;
      if (side === "start") {
        const { prev } = findAdjacent(
          eventsRef.current,
          draftEndRef.current,
          day,
          excludeId,
        );
        const minStart = prev ? new Date(prev.endUtc).getTime() : 0;
        const maxStart = draftEndRef.current.getTime() - MIN_MS;
        const clamped = Math.min(
          Math.max(newUtc.getTime(), minStart),
          maxStart,
        );
        setDraftStart(new Date(clamped));
      } else {
        const { next } = findAdjacent(
          eventsRef.current,
          draftStartRef.current,
          day,
          excludeId,
        );
        const maxEnd = next
          ? new Date(next.startUtc).getTime()
          : Number.POSITIVE_INFINITY;
        const minEnd = draftStartRef.current.getTime() + MIN_MS;
        const clamped = Math.max(
          Math.min(newUtc.getTime(), maxEnd),
          minEnd,
        );
        setDraftEnd(new Date(clamped));
      }
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!moved && pickingSideRef.current !== side) enterPicking(side);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const todayISO = DateTime.now().setZone("America/Los_Angeles").toISODate()!;
  const draftDayISO = fromUtc(draftStart).toISODate();
  const nCols = days.length;
  // Float-right threshold: for week (7) this is 4 → cols 0..3 right, 4..6 left.
  // For single day, always right.
  const floatRightCutoff = Math.ceil(nCols / 2);
  const gridCols = `2.5rem repeat(${nCols}, minmax(0, 1fr))`;

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
      >
        {/* Sticky block containing the day labels and (optionally) the
            all-day row. Kept together so both stay pinned at the top. */}
        <div className="sticky top-0 z-10 bg-background">
        {showDayLabels && (
          <div
            className="grid border-b bg-background"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div />
            {days.map((d) => {
              const isToday = d.toISODate() === todayISO;
              return (
                <Link
                  key={d.toISODate()}
                  href={`/calendar/day/${d.toISODate()}`}
                  className="flex items-center justify-center gap-1.5 px-1 py-0.5 text-center hover:bg-accent"
                >
                  <span
                    className={`text-sm font-bold uppercase ${
                      isToday ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {d.toFormat("ccc")}
                  </span>
                  {isToday ? (
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                      {d.toFormat("d")}
                    </span>
                  ) : (
                    <span className="text-base font-bold">
                      {d.toFormat("d")}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
        {allDayRow}
        </div>

        <div
          className="relative grid"
          style={{
            gridTemplateColumns: gridCols,
            height: `${TOTAL_SLOTS * SLOT_HEIGHT}px`,
          }}
        >
          <div className="relative">
            {HOURS.map((h) => {
              const top = (h - VISIBLE_START_HOUR) * HOUR_HEIGHT;
              const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
              const ampm = h < 12 ? "AM" : "PM";
              return (
                <div
                  key={h}
                  className="absolute flex flex-col items-center justify-center leading-none text-foreground"
                  style={{
                    top: `${top}px`,
                    height: `${HOUR_HEIGHT}px`,
                    width: "100%",
                  }}
                >
                  <span className="text-xl font-bold leading-none">{hour12}</span>
                  <span className="mt-0.5 text-[10px] font-medium">{ampm}</span>
                </div>
              );
            })}
          </div>

          {days.map((day, dayIndex) => (
            <div
              key={day.toISODate()}
              data-day-column
              data-date={day.toISODate()}
              className="relative border-l-2 border-b border-foreground/20"
            >
              {Array.from({ length: TOTAL_SLOTS }, (_, i) => {
                const hour = VISIBLE_START_HOUR + Math.floor(i / SLOTS_PER_HOUR);
                const minute = (i % SLOTS_PER_HOUR) * SLOT_MINUTES;
                const isHourBoundary = minute === 0;
                const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                const slotLabel = `${hour12}:${String(minute).padStart(2, "0")}`;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSlotClick(day, hour, minute)}
                    className={`group absolute left-0 right-0 hover:bg-accent/40 ${
                      pickingSide ? "cursor-crosshair" : ""
                    } ${
                      isHourBoundary
                        ? "border-t border-foreground/30"
                        : "border-t border-foreground/10"
                    }`}
                    style={{
                      top: `${i * SLOT_HEIGHT}px`,
                      height: `${SLOT_HEIGHT}px`,
                    }}
                  >
                    <span
                      className="pointer-events-none absolute left-1 top-0 text-[11px] leading-none text-muted-foreground opacity-0 group-hover:opacity-100"
                    >
                      {slotLabel}
                    </span>
                  </button>
                );
              })}

              {dialogOpen && (() => {
                const pos = eventPositionInDay(draftStart, draftEnd, day);
                if (!pos) return null;
                const topPx = (pos.topMin / SLOT_MINUTES) * SLOT_HEIGHT;
                const heightPx =
                  (pos.durationMin / SLOT_MINUTES) * SLOT_HEIGHT;
                return (
                  <div
                    className="pointer-events-none absolute left-0 right-0 border-2 border-primary bg-primary/15"
                    style={{ top: `${topPx}px`, height: `${heightPx}px` }}
                  >
                    <div
                      onPointerDown={(e) => beginDrag("start", day, e)}
                      title="Click or drag to change start time"
                      className="pointer-events-auto absolute inset-x-0 -top-2 flex h-4 cursor-pointer items-center justify-center gap-2"
                    >
                      <div
                        className={`rounded-full bg-primary transition-all ${
                          pickingSide === "start"
                            ? "h-0.5 w-16 animate-pulse"
                            : "h-1 w-12"
                        }`}
                      />
                      <span
                        className={`rounded bg-background px-1 text-[10px] font-medium leading-tight ring-1 ring-primary/40 ${
                          pickingSide === "start"
                            ? "text-primary"
                            : "text-foreground"
                        }`}
                      >
                        {fromUtc(draftStart).toFormat("h:mma")}
                      </span>
                    </div>
                    <div
                      onPointerDown={(e) => beginDrag("end", day, e)}
                      title="Click or drag to change end time"
                      className="pointer-events-auto absolute inset-x-0 -bottom-2 flex h-4 cursor-pointer items-center justify-center gap-2"
                    >
                      <div
                        className={`rounded-full bg-primary transition-all ${
                          pickingSide === "end"
                            ? "h-0.5 w-16 animate-pulse"
                            : "h-1 w-12"
                        }`}
                      />
                      <span
                        className={`rounded bg-background px-1 text-[10px] font-medium leading-tight ring-1 ring-primary/40 ${
                          pickingSide === "end"
                            ? "text-primary"
                            : "text-foreground"
                        }`}
                      >
                        {fromUtc(draftEnd).toFormat("h:mma")}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {events
                .filter(
                  (e) =>
                    e.id !== editingEvent?.id &&
                    eventOverlapsDay(
                      new Date(e.startUtc),
                      new Date(e.endUtc),
                      day,
                    ),
                )
                .map((e) => {
                  const pos = eventPositionInDay(
                    new Date(e.startUtc),
                    new Date(e.endUtc),
                    day,
                  );
                  if (!pos) return null;
                  const visStart = VISIBLE_START_HOUR * 60;
                  const rawStart = pos.topMin;
                  const rawEnd = pos.topMin + pos.durationMin;
                  const clippedStart = Math.max(rawStart, visStart);
                  const clippedEnd = Math.min(rawEnd, VISIBLE_END_HOUR * 60);
                  if (clippedEnd <= clippedStart) return null;
                  const topPx =
                    ((clippedStart - visStart) / SLOT_MINUTES) * SLOT_HEIGHT;
                  const heightPx =
                    ((clippedEnd - clippedStart) / SLOT_MINUTES) * SLOT_HEIGHT -
                    1;
                  const cat = e.categoryId ? categoryById[e.categoryId] : null;
                  const color = cat?.color ?? "#6b7280";
                  const singleLine = heightPx < 30;
                  const spread = !singleLine;
                  const startStr = fromUtc(new Date(e.startUtc)).toFormat(
                    "h:mm",
                  );
                  const endStr = fromUtc(new Date(e.endUtc)).toFormat("h:mm");

                  const isHalfHour = pos.durationMin === 30;
                  const isTwentyMin = pos.durationMin === 20;
                  const isTenMin = pos.durationMin === 10;
                  let titleClass: string;
                  let timeClass: string;
                  if (heightPx < 12) {
                    titleClass = isTenMin
                      ? "text-[8px] leading-none"
                      : "text-[7px] leading-none";
                    timeClass = isTenMin
                      ? "text-[8px] leading-none"
                      : "text-[7px] leading-none";
                  } else if (heightPx < 22) {
                    titleClass = isTwentyMin
                      ? "text-[10px] leading-none"
                      : "text-[9px] leading-none";
                    timeClass = isTwentyMin
                      ? "text-[10px] leading-none"
                      : "text-[9px] leading-none";
                  } else if (singleLine) {
                    titleClass = isHalfHour
                      ? "text-xs leading-tight"
                      : "text-[10px] leading-tight";
                    timeClass = isHalfHour
                      ? "text-xs leading-tight"
                      : "text-[10px] leading-tight";
                  } else if (heightPx >= 50) {
                    titleClass = "text-sm leading-tight";
                    timeClass = "text-xs leading-tight";
                  } else {
                    titleClass = "text-xs leading-tight";
                    timeClass = "text-[11px] leading-tight";
                  }

                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => {
                        if (dialogOpen) return;
                        openEdit(e);
                      }}
                      className={`absolute left-0 right-0 overflow-hidden text-left text-white ${
                        heightPx < 22 ? "px-1 py-0" : "px-1.5 py-0.5"
                      } ${!singleLine ? "flex flex-col" : ""}`}
                      style={{
                        top: `${topPx}px`,
                        height: `${heightPx}px`,
                        backgroundColor: color,
                      }}
                      title={`${e.title} — ${startStr} – ${endStr}`}
                    >
                      {singleLine ? (
                        <div
                          className={`flex items-baseline gap-1 tracking-tight ${titleClass}`}
                        >
                          <span className="min-w-0 truncate font-bold">
                            {e.title}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums">
                            {startStr}–{endStr}
                          </span>
                        </div>
                      ) : (
                        <>
                          <div
                            className={`shrink-0 text-left font-medium tabular-nums tracking-tight ${timeClass}`}
                          >
                            {startStr}
                          </div>
                          <div
                            className={`flex min-w-0 flex-1 items-center font-bold tracking-tight ${titleClass}`}
                          >
                            <span className="truncate">{e.title}</span>
                          </div>
                          <div
                            className={`shrink-0 text-left font-medium tabular-nums tracking-tight ${timeClass}`}
                          >
                            {endStr}
                          </div>
                        </>
                      )}
                    </button>
                  );
                })}

              {dialogOpen && day.toISODate() === draftDayISO && (() => {
                const pos = eventPositionInDay(draftStart, draftEnd, day);
                if (!pos) return null;
                const topPx = (pos.topMin / SLOT_MINUTES) * SLOT_HEIGHT;
                const floatRight = dayIndex < floatRightCutoff;
                // Single-day view: overlay the dialog inside the column so it
                // doesn't extend past the scroll container and push layout.
                // Multi-day: anchor outside the column, into the neighbors.
                const positionClass =
                  nCols === 1
                    ? "right-2"
                    : floatRight
                      ? "left-full ml-2"
                      : "right-full mr-2";
                // If the draft starts in the lower half of the user's
                // current viewport (not the whole 24h grid), anchor the
                // dialog's *bottom* to the draft start so the whole card
                // stays visible above instead of running off-screen.
                const gridHeight = TOTAL_SLOTS * SLOT_HEIGHT;
                const scroller = scrollRef.current;
                const visibleTop = scroller?.scrollTop ?? 0;
                const visibleHeight = scroller?.clientHeight ?? gridHeight;
                const visibleMid = visibleTop + visibleHeight / 2;
                const anchorBottom = topPx > visibleMid;
                const anchorStyle = anchorBottom
                  ? { bottom: `${gridHeight - topPx}px` }
                  : { top: `${topPx}px` };
                return (
                  <div
                    className={`absolute z-30 w-[340px] ${positionClass}`}
                    style={anchorStyle}
                  >
                    <EventDialog
                      open={dialogOpen}
                      onOpenChange={(v) => {
                        if (!v && pickingSide) cancelPicking();
                        setDialogOpen(v);
                        if (!v) setEditingEvent(undefined);
                      }}
                      event={editingEvent}
                      startUtc={draftStart}
                      endUtc={draftEnd}
                      pickingSide={pickingSide}
                      onPick={handlePick}
                    />
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
        {bottomRow && (
          <div className="sticky bottom-0 z-10 bg-background">{bottomRow}</div>
        )}
      </div>
    </div>
  );
}
