"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { XIcon } from "lucide-react";
import { DateTime } from "luxon";
import { api } from "@/lib/api";
import { getLastEdited, markEditingFocus } from "@/lib/editingBus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RecurrenceEditor } from "./RecurrenceEditor";
import { DaysBeforeReminderEditor } from "./ReminderEditor";

export type BigEventModel = {
  id: string;
  seriesId?: string;
  title: string;
  notes: string | null;
  date: string; // ISO date string from JSON (@db.Date → midnight UTC)
  categoryId: string | null;
  rrule?: string | null;
  isOccurrence?: boolean;
  reminders?: { daysBefore: number }[];
};

const formSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  notes: z.string().max(4000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date is required"),
  rrule: z.string().nullable(),
  reminders: z.array(z.object({ daysBefore: z.number().int().min(0) })),
});

type FormValues = z.infer<typeof formSchema>;

type SaveScope = "series" | "occurrence" | "following";

type PendingAction =
  | { type: "save"; values: FormValues }
  | { type: "delete" }
  | null;

export function BigEventDialog({
  open,
  onOpenChange,
  bigEvent,
  defaultDateISO,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bigEvent?: BigEventModel;
  defaultDateISO: string; // YYYY-MM-DD
}) {
  const qc = useQueryClient();

  const isEdit = !!bigEvent;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const watchedRule = watch("rrule");
  const watchedDate = watch("date");
  const watchedReminders = watch("reminders");
  const defaultWeekday = watchedDate
    ? DateTime.fromISO(watchedDate).weekday - 1
    : 0;
  const isOccurrence = !!bigEvent?.isOccurrence;
  const seriesId = bigEvent?.seriesId ?? bigEvent?.id;
  const [pending, setPending] = useState<PendingAction>(null);

  useEffect(() => {
    if (!open) setPending(null);
  }, [open, bigEvent?.id]);

  useEffect(() => {
    if (!open) return;
    if (bigEvent) {
      // The server stores @db.Date as midnight UTC; slice to YYYY-MM-DD.
      reset({
        title: bigEvent.title,
        notes: bigEvent.notes ?? "",
        date: bigEvent.date.slice(0, 10),
        rrule: bigEvent.rrule ?? null,
        reminders: bigEvent.reminders ?? [],
      });
    } else {
      // Default: one reminder, the day before at 10pm.
      reset({
        title: "",
        notes: "",
        date: defaultDateISO,
        rrule: null,
        reminders: [{ daysBefore: 1 }],
      });
    }
  }, [open, bigEvent, defaultDateISO, reset]);

  // For non-recurring rows / new rows, save+delete go to the parent endpoint.
  // For a recurring occurrence we route by scope:
  //   "occurrence" → /occurrence (BigEventException upsert / cancel)
  //   "following"  → /split (truncate parent, optional new series)
  const save = useMutation({
    mutationFn: async ({
      values,
      scope,
    }: {
      values: FormValues;
      scope: SaveScope;
    }) => {
      if (scope === "occurrence" && bigEvent?.isOccurrence) {
        // Reminders are series-level (no per-exception reminder model), so
        // they ride along on the parent even on a "this event" save.
        return api.patch(`/api/big-events/${seriesId}/occurrence`, {
          originalDate: bigEvent.date.slice(0, 10),
          title: values.title,
          notes: values.notes || null,
          reminders: values.reminders,
        });
      }
      if (scope === "following" && bigEvent?.isOccurrence) {
        return api.post(`/api/big-events/${seriesId}/split`, {
          originalDate: bigEvent.date.slice(0, 10),
          action: "edit",
          title: values.title,
          notes: values.notes || null,
          date: values.date,
          rrule: values.rrule || null,
          reminders: values.reminders,
        });
      }
      const body = {
        title: values.title,
        notes: values.notes || null,
        date: values.date,
        rrule: values.rrule || null,
        reminders: values.reminders,
      };
      if (isEdit) return api.patch(`/api/big-events/${seriesId}`, body);
      return api.post("/api/big-events", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["big-events"] });
      onOpenChange(false);
    },
  });

  const del = useMutation({
    mutationFn: async (scope: SaveScope) => {
      if (scope === "occurrence" && bigEvent?.isOccurrence) {
        return api.del(
          `/api/big-events/${seriesId}/occurrence?originalDate=${encodeURIComponent(
            bigEvent.date.slice(0, 10),
          )}`,
        );
      }
      if (scope === "following" && bigEvent?.isOccurrence) {
        return api.post(`/api/big-events/${seriesId}/split`, {
          originalDate: bigEvent.date.slice(0, 10),
          action: "delete",
        });
      }
      return api.del(`/api/big-events/${seriesId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["big-events"] });
      onOpenChange(false);
    },
  });

  function requestSave(values: FormValues) {
    if (isOccurrence) {
      setPending({ type: "save", values });
      return;
    }
    save.mutate({ values, scope: "series" });
  }
  function requestDelete() {
    if (!bigEvent) return;
    if (isOccurrence) {
      setPending({ type: "delete" });
      return;
    }
    del.mutate("series");
  }

  // Enter → save. Shift+Enter → delete (only when editing). Escape → cancel.
  // Esc backs out of the scope prompt before closing the dialog. Matches
  // EventDialog.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (getLastEdited() !== "big-event") return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (pending) setPending(null);
        else onOpenChange(false);
        return;
      }
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      const inTextarea = target?.tagName === "TEXTAREA";
      if (e.shiftKey) {
        if (inTextarea) return;
        if (!bigEvent) return;
        e.preventDefault();
        requestDelete();
        return;
      }
      if (inTextarea) return;
      e.preventDefault();
      handleSubmit(requestSave)();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bigEvent, pending, isOccurrence]);

  if (!open) return null;

  return (
    <div
      className="relative flex h-full max-h-[80vh] flex-col overflow-hidden rounded-lg border bg-background shadow-2xl"
      role="dialog"
      aria-modal="false"
      onFocusCapture={() => markEditingFocus("big-event")}
      onPointerDownCapture={() => markEditingFocus("big-event")}
    >
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-base font-semibold">
          {isEdit ? "Edit all-day event" : "New all-day event"}
        </h2>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="rounded-md p-1 hover:bg-accent"
          aria-label="Close"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <form
        onSubmit={handleSubmit(requestSave)}
        className="flex flex-1 flex-col gap-4 overflow-auto p-4"
      >
        <div className="space-y-1">
          <Label htmlFor="title">Title</Label>
          <Input id="title" {...register("title")} autoFocus />
          {errors.title && (
            <p className="text-xs text-destructive">{errors.title.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="date">Date</Label>
          <Input id="date" type="date" {...register("date")} />
          {errors.date && (
            <p className="text-xs text-destructive">{errors.date.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label>Repeat</Label>
          <RecurrenceEditor
            value={watchedRule ?? null}
            onChange={(rule) =>
              setValue("rrule", rule, { shouldDirty: true })
            }
            defaultWeekday={defaultWeekday}
          />
        </div>

        <div className="space-y-1">
          <Label>Reminders</Label>
          <DaysBeforeReminderEditor
            value={watchedReminders ?? []}
            onChange={(next) =>
              setValue("reminders", next, { shouldDirty: true })
            }
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" rows={3} {...register("notes")} />
        </div>

        {save.error && (
          <p className="text-sm text-destructive">
            {(save.error as Error).message}
          </p>
        )}

        <div className="mt-auto flex items-center justify-end gap-2 border-t pt-4">
          {isEdit && (
            <Button
              type="button"
              variant="outline"
              onClick={requestDelete}
              disabled={del.isPending}
            >
              Delete
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || save.isPending}>
            {isEdit ? "Save" : "Create"}
          </Button>
        </div>
      </form>

      {pending && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onClick={() => setPending(null)}
        >
          <div
            className="w-full rounded-lg border bg-background p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <p className="mb-4 text-sm">
              {pending.type === "save"
                ? "Save changes to this event only, or this and every following event in the series?"
                : "Delete this event only, or this and every following event in the series?"}
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending || del.isPending}
                onClick={() => {
                  if (pending.type === "save") {
                    save.mutate({
                      values: pending.values,
                      scope: "following",
                    });
                  } else {
                    del.mutate("following");
                  }
                }}
              >
                This and following
              </Button>
              <Button
                type="button"
                disabled={save.isPending || del.isPending}
                onClick={() => {
                  if (pending.type === "save") {
                    save.mutate({
                      values: pending.values,
                      scope: "occurrence",
                    });
                  } else {
                    del.mutate("occurrence");
                  }
                }}
              >
                This event
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

