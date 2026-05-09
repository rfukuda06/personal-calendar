"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api } from "@/lib/api";
import { fromUtc, toLocalInputValue } from "@/lib/time";
import { announceEditing, subscribeEditing } from "@/lib/editingBus";
import { DueDateDialog, type DueDateModel } from "./DueDateDialog";

/**
 * Strip rendered directly under the BigEventBar. One cell per day. Each
 * cell holds chips for that day's due dates (sorted by time). Click empty
 * space → new due date for that day at 9 AM. Click a chip → edit.
 */
export function DueDateBar({
  days,
  rangeStart,
  rangeEnd,
  size = "sm",
}: {
  days: DateTime[];
  rangeStart: DateTime;
  rangeEnd: DateTime;
  /** "md" gives a slightly taller cell + larger chip text — used in day view
   *  where there's only one column to fill. */
  size?: "sm" | "md";
}) {
  const fromISO = rangeStart.toUTC().toISO()!;
  const toISO = rangeEnd.toUTC().toISO()!;

  const { data: dueDates = [] } = useQuery({
    queryKey: ["due-dates", fromISO, toISO],
    queryFn: () =>
      api.get<DueDateModel[]>(
        `/api/due-dates?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
      ),
    placeholderData: keepPreviousData,
  });

  // Group due dates by their LA-local YYYY-MM-DD (the day they belong to in
  // the viewer's timezone).
  const byDate = useMemo(() => {
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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DueDateModel | undefined>();
  const [defaultDueAtISO, setDefaultDueAtISO] = useState<string>("");

  function openNew(dayISO: string) {
    setEditing(undefined);
    // Default to 9 AM LA on the chosen day. User can change in the dialog.
    setDefaultDueAtISO(`${dayISO}T09:00`);
    setDialogOpen(true);
    announceEditing("due-date");
  }
  function openEdit(d: DueDateModel) {
    setEditing(d);
    setDefaultDueAtISO(toLocalInputValue(new Date(d.dueAt)));
    setDialogOpen(true);
    announceEditing("due-date");
  }

  // Cancel our dialog when an Event or BigEvent dialog opens. Notes coexist.
  useEffect(() => {
    return subscribeEditing((source) => {
      if (source === "due-date" || source === "note") return;
      if (!dialogOpen) return;
      setDialogOpen(false);
      setEditing(undefined);
    });
  }, [dialogOpen]);

  const gridCols = `2.5rem repeat(${days.length}, minmax(0, 1fr))`;
  const cellMinH = size === "md" ? "min-h-[28px]" : "min-h-[22px]";
  const chipText = size === "md" ? "text-xs" : "text-[11px]";

  return (
    <>
      <div
        className="grid border-t bg-background"
        style={{ gridTemplateColumns: gridCols }}
      >
        <div className="flex flex-col items-center justify-center py-0.5 text-[8px] font-semibold uppercase leading-tight text-muted-foreground">
          <span>Due</span>
        </div>
        {days.map((d) => {
          const iso = d.toISODate()!;
          const items = byDate[iso] ?? [];
          return (
            <button
              key={iso}
              type="button"
              onClick={() => openNew(iso)}
              className={`group flex ${cellMinH} min-w-0 cursor-pointer flex-col items-stretch justify-center gap-0.5 self-stretch border-l border-foreground/20 px-0.5 py-0.5 hover:bg-accent/30`}
            >
              {items.map((b) => {
                const time = fromUtc(new Date(b.dueAt)).toFormat("h:mma");
                return (
                  <span
                    key={b.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(b);
                    }}
                    className={`flex items-center justify-center gap-1 overflow-hidden truncate bg-foreground px-1 text-center font-bold leading-tight text-background ${chipText}`}
                    title={`${time} — ${b.title}`}
                  >
                    <span className="min-w-0 truncate">{b.title}</span>
                    <span className="shrink-0 font-medium tabular-nums opacity-80">
                      {time}
                    </span>
                  </span>
                );
              })}
              {/* Always-visible + so additional due dates can be added even
                  when chips already fill the cell. */}
              <span className="pointer-events-none flex select-none items-center justify-center text-base font-medium leading-none text-foreground/60 transition-colors group-hover:text-foreground/90">
                +
              </span>
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
            <DueDateDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              dueDate={editing}
              defaultDueAtISO={defaultDueAtISO}
            />
          </div>
        </div>
      )}
    </>
  );
}
