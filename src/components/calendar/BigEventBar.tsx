"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api } from "@/lib/api";
import { BigEventDialog, type BigEventModel } from "./BigEventDialog";
import { announceEditing, subscribeEditing } from "@/lib/editingBus";

export function BigEventBar({
  days,
  rangeStart,
  rangeEnd,
}: {
  days: DateTime[];
  rangeStart: DateTime;
  rangeEnd: DateTime;
}) {
  const fromISO = rangeStart.toISODate()!;
  const toISO = rangeEnd.toISODate()!;

  const { data: bigEvents = [] } = useQuery({
    queryKey: ["big-events", fromISO, toISO],
    queryFn: () =>
      api.get<BigEventModel[]>(
        `/api/big-events?from=${fromISO}&to=${toISO}`,
      ),
    placeholderData: keepPreviousData,
  });

  // Group big events by YYYY-MM-DD. Database stores midnight UTC, so the
  // first 10 chars of the ISO string are the calendar date regardless of
  // viewer timezone.
  const byDate = useMemo(() => {
    const out: Record<string, BigEventModel[]> = {};
    for (const b of bigEvents) {
      const key = b.date.slice(0, 10);
      (out[key] ||= []).push(b);
    }
    return out;
  }, [bigEvents]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BigEventModel | undefined>();
  const [defaultDateISO, setDefaultDateISO] = useState<string>(
    days[0]?.toISODate() ?? "",
  );

  function openNew(iso: string) {
    setEditing(undefined);
    setDefaultDateISO(iso);
    setDialogOpen(true);
    announceEditing("big-event");
  }
  function openEdit(b: BigEventModel) {
    setEditing(b);
    setDefaultDateISO(b.date.slice(0, 10));
    setDialogOpen(true);
    announceEditing("big-event");
  }

  // Cancel our dialog when an Event or DueDate dialog opens. Notes coexist.
  useEffect(() => {
    return subscribeEditing((source) => {
      if (source !== "event" && source !== "due-date") return;
      if (!dialogOpen) return;
      setDialogOpen(false);
      setEditing(undefined);
    });
  }, [dialogOpen]);

  const gridCols = `2.5rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <>
      <div
        className="grid border-b bg-background"
        style={{ gridTemplateColumns: gridCols }}
      >
        <div className="flex flex-col items-center justify-center py-0.5 text-[8px] font-semibold uppercase leading-tight text-muted-foreground">
          <span>All</span>
          <span>day</span>
        </div>
        {days.map((d) => {
          const iso = d.toISODate()!;
          const items = byDate[iso] ?? [];
          return (
            <button
              key={iso}
              type="button"
              onClick={() => openNew(iso)}
              className="group flex min-h-[22px] min-w-0 cursor-pointer flex-col items-stretch justify-center gap-0 self-stretch border-l border-foreground/20 px-0 py-0 hover:bg-accent/30"
            >
              {items.map((b) => {
                return (
                  <span
                    key={b.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(b);
                    }}
                    className="flex flex-1 items-center justify-center overflow-hidden truncate border-2 border-foreground bg-muted px-1 text-center text-sm font-bold leading-none text-foreground shadow-sm"
                    title={b.title}
                  >
                    {b.title}
                  </span>
                );
              })}
              {items.length === 0 && (
                <span className="pointer-events-none flex select-none items-center justify-center text-base font-medium leading-none text-foreground/60 transition-colors group-hover:text-foreground/90">
                  +
                </span>
              )}
            </button>
          );
        })}
      </div>

      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDialogOpen(false)}
        >
          <div
            className="w-[340px]"
            onClick={(e) => e.stopPropagation()}
          >
            <BigEventDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              bigEvent={editing}
              defaultDateISO={defaultDateISO}
            />
          </div>
        </div>
      )}
    </>
  );
}
