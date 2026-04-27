"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api";
import { getLastEdited, markEditingFocus } from "@/lib/editingBus";
import { fromUtc } from "@/lib/time";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RecurrenceEditor } from "./RecurrenceEditor";

type Category = { id: string; name: string; color: string };

export type EventModel = {
  id: string;
  seriesId: string;
  title: string;
  notes: string | null;
  startUtc: string; // ISO from JSON
  endUtc: string;
  categoryId: string | null;
  rrule: string | null;
  isOccurrence: boolean;
  originalStartUtc: string | null;
};

export type PickingSide = "start" | "end" | null;

const formSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  notes: z.string().max(4000),
  categoryId: z.string(),
  rrule: z.string().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

// "series": non-recurring or whole-series mutation (create / edit a single
// event). "occurrence": one occurrence of a recurring series (EventException).
// "following": this occurrence and every future one — splits the series.
// Past occurrences are never modified by "occurrence" or "following".
type SaveScope = "series" | "occurrence" | "following";

type PendingAction =
  | { type: "save"; values: FormValues }
  | { type: "delete" }
  | null;

export function EventDialog({
  open,
  onOpenChange,
  event,
  startUtc,
  endUtc,
  pickingSide,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: EventModel;
  startUtc: Date;
  endUtc: Date;
  pickingSide: PickingSide;
  onPick: (side: "start" | "end") => void;
}) {
  const qc = useQueryClient();
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/categories"),
    enabled: open,
  });

  const isEdit = !!event;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const selectedCategoryId = watch("categoryId");

  useEffect(() => {
    if (!open) return;
    if (event) {
      reset({
        title: event.title,
        notes: event.notes ?? "",
        categoryId: event.categoryId ?? "",
        rrule: event.rrule ?? null,
      });
    } else {
      reset({ title: "", notes: "", categoryId: "", rrule: null });
    }
  }, [open, event, reset]);

  const watchedRule = watch("rrule");
  const isOccurrence = !!event?.isOccurrence;
  const [pending, setPending] = useState<PendingAction>(null);

  // Reset the scope prompt when the dialog opens/closes or swaps events.
  useEffect(() => {
    if (!open) setPending(null);
  }, [open, event?.id]);

  // For a recurring series being edited as a single occurrence, save targets
  // either the parent (series) or upserts an EventException (occurrence).
  // Non-recurring + new events always go to the parent endpoint.
  const save = useMutation({
    mutationFn: async ({
      values,
      scope,
    }: {
      values: FormValues;
      scope: SaveScope;
    }) => {
      if (endUtc.getTime() <= startUtc.getTime()) {
        throw new Error("End time must be after start time");
      }
      if (scope === "occurrence" && event?.originalStartUtc) {
        return api.patch(`/api/events/${event.seriesId}/occurrence`, {
          originalStartUtc: event.originalStartUtc,
          title: values.title,
          notes: values.notes || null,
          startUtc,
          endUtc,
        });
      }
      if (scope === "following" && event?.originalStartUtc) {
        return api.post(`/api/events/${event.seriesId}/split`, {
          originalStartUtc: event.originalStartUtc,
          action: "edit",
          title: values.title,
          notes: values.notes || null,
          startUtc,
          endUtc,
          categoryId: values.categoryId || null,
          rrule: values.rrule || null,
        });
      }
      const body = {
        title: values.title,
        notes: values.notes || null,
        startUtc,
        endUtc,
        categoryId: values.categoryId || null,
        rrule: values.rrule || null,
      };
      if (isEdit) return api.patch(`/api/events/${event!.seriesId}`, body);
      return api.post("/api/events", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      onOpenChange(false);
    },
  });

  const del = useMutation({
    mutationFn: async (scope: SaveScope) => {
      if (scope === "occurrence" && event?.originalStartUtc) {
        return api.del(
          `/api/events/${event.seriesId}/occurrence?originalStartUtc=${encodeURIComponent(event.originalStartUtc)}`,
        );
      }
      if (scope === "following" && event?.originalStartUtc) {
        return api.post(`/api/events/${event.seriesId}/split`, {
          originalStartUtc: event.originalStartUtc,
          action: "delete",
        });
      }
      return api.del(`/api/events/${event!.seriesId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      onOpenChange(false);
    },
  });

  const timeInvalid = endUtc.getTime() <= startUtc.getTime();

  // Keyboard shortcuts while the dialog is open (from anywhere on the page):
  //   Enter          → save (in a textarea, Enter inserts a newline)
  //   Shift+Enter    → delete the event (only when editing). In a textarea,
  //                    inserts a newline.
  //   Escape         → close the dialog without saving (cancel)
  // Centralized "the user wants to save / delete" entry points. For a single
  // occurrence of a recurring event, these stage a `pending` action so the
  // footer can show the "this event / all events" choice; for everything
  // else they fire the mutation directly.
  function requestSave(values: FormValues) {
    if (timeInvalid) return;
    if (isOccurrence) {
      setPending({ type: "save", values });
      return;
    }
    save.mutate({ values, scope: "series" });
  }
  function requestDelete() {
    if (!event) return;
    if (isOccurrence) {
      setPending({ type: "delete" });
      return;
    }
    del.mutate("series");
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      // When a Todo edit row is also open, defer to whichever surface was
      // touched most recently.
      if (getLastEdited() !== "event") return;
      if (e.key === "Escape") {
        e.preventDefault();
        // Esc backs out of the scope prompt before closing the whole dialog.
        if (pending) setPending(null);
        else onOpenChange(false);
        return;
      }
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      const inTextarea = target?.tagName === "TEXTAREA";

      if (e.shiftKey) {
        if (inTextarea) return; // let newline happen
        if (!event) return; // delete only applies when editing
        e.preventDefault();
        requestDelete();
        return;
      }

      // Plain Enter → save (unless inside a textarea, where Enter makes newline).
      if (inTextarea) return;
      e.preventDefault();
      handleSubmit(requestSave)();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event, pending, isOccurrence, timeInvalid]);

  if (!open) return null;

  return (
    <div
      className="relative flex h-full max-h-[80vh] flex-col overflow-hidden rounded-lg border bg-background shadow-2xl"
      role="dialog"
      aria-modal="false"
      onFocusCapture={() => markEditingFocus("event")}
      onPointerDownCapture={() => markEditingFocus("event")}
    >
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-base font-semibold">
          {isEdit ? "Edit event" : "New event"}
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

      {pickingSide && (
        <div className="border-b bg-primary/10 px-4 py-2 text-xs">
          Click a slot on the calendar to set the{" "}
          <strong>{pickingSide === "start" ? "start" : "end"}</strong> time.{" "}
          <button
            type="button"
            onClick={() => onPick(pickingSide)}
            className="underline"
          >
            cancel
          </button>
        </div>
      )}

      <form
        onSubmit={handleSubmit(requestSave)}
        className="flex flex-1 flex-col gap-4 overflow-auto p-4"
      >
        {timeInvalid && (
          <p className="text-xs text-destructive">
            End must be after start.
          </p>
        )}

        <div className="space-y-1">
          <Label htmlFor="title">Title</Label>
          <Input id="title" {...register("title")} autoFocus />
          {errors.title && (
            <p className="text-xs text-destructive">{errors.title.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label>Category</Label>
          <div className="flex flex-wrap gap-1">
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                name={c.name}
                color={c.color}
                selected={selectedCategoryId === c.id}
                onClick={() =>
                  setValue("categoryId", c.id, { shouldDirty: true })
                }
              />
            ))}
            <CategoryChip
              name="None"
              color={null}
              selected={!selectedCategoryId}
              onClick={() =>
                setValue("categoryId", "", { shouldDirty: true })
              }
            />
          </div>
        </div>

        {/* Recurrence is always editable. On a recurring occurrence, a rule
            change only takes effect if the user picks "This and following"
            (which splits the series at this point); "This event" leaves the
            parent's rule untouched. */}
        <div className="space-y-1">
          <Label>Repeat</Label>
          <RecurrenceEditor
            value={watchedRule ?? null}
            onChange={(rule) =>
              setValue("rrule", rule, { shouldDirty: true })
            }
            defaultWeekday={fromUtc(startUtc).weekday - 1}
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
          <Button
            type="submit"
            disabled={isSubmitting || save.isPending || timeInvalid}
          >
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

function CategoryChip({
  color,
  name,
  selected,
  onClick,
}: {
  color: string | null;
  name: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded border px-2 py-0.5 text-xs transition-colors ${
        selected ? "border-primary ring-1 ring-primary" : "hover:bg-accent"
      }`}
    >
      {color && (
        <span
          className="inline-block size-2.5 rounded-sm"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      <span>{name}</span>
    </button>
  );
}
