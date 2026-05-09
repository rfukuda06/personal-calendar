"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { XIcon } from "lucide-react";
import { api } from "@/lib/api";
import { getLastEdited, markEditingFocus } from "@/lib/editingBus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fromLocalInputValue,
  fromUtc,
  toLocalInputValue,
} from "@/lib/time";
import { RecurrenceEditor } from "./RecurrenceEditor";
import { OffsetReminderEditor } from "./ReminderEditor";

export type DueDateModel = {
  id: string;
  seriesId: string;
  title: string;
  dueAt: string; // ISO datetime from JSON
  categoryId: string | null;
  rrule: string | null;
  isOccurrence: boolean;
  originalDueAt: string | null;
  reminders: { offsetMinutes: number }[];
};

const formSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  dueAt: z.string().min(1, "Time is required"),
  rrule: z.string().nullable(),
  reminders: z.array(z.object({ offsetMinutes: z.number().int().min(0) })),
});

type FormValues = z.infer<typeof formSchema>;

type SaveScope = "series" | "occurrence" | "following";

type PendingAction =
  | { type: "save"; values: FormValues }
  | { type: "delete" }
  | null;

export function DueDateDialog({
  open,
  onOpenChange,
  dueDate,
  defaultDueAtISO,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dueDate?: DueDateModel;
  /** Local "YYYY-MM-DDTHH:mm" (LA-zone) used for new entries. */
  defaultDueAtISO: string;
}) {
  const qc = useQueryClient();

  const isEdit = !!dueDate;
  const isOccurrence = !!dueDate?.isOccurrence;
  const seriesId = dueDate?.seriesId ?? dueDate?.id;
  const [pending, setPending] = useState<PendingAction>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const watchedRule = watch("rrule");
  const watchedDueAt = watch("dueAt");
  const watchedReminders = watch("reminders");

  useEffect(() => {
    if (!open) {
      setPending(null);
      return;
    }
    if (dueDate) {
      reset({
        title: dueDate.title,
        dueAt: toLocalInputValue(new Date(dueDate.dueAt)),
        rrule: dueDate.rrule ?? null,
        reminders: dueDate.reminders ?? [],
      });
    } else {
      // Default: one reminder at 6 hours before.
      reset({
        title: "",
        dueAt: defaultDueAtISO,
        rrule: null,
        reminders: [{ offsetMinutes: 6 * 60 }],
      });
    }
  }, [open, dueDate, defaultDueAtISO, reset]);

  const save = useMutation({
    mutationFn: async ({
      values,
      scope,
    }: {
      values: FormValues;
      scope: SaveScope;
    }) => {
      const dueAt = fromLocalInputValue(values.dueAt);
      if (scope === "occurrence" && dueDate?.originalDueAt) {
        return api.patch(`/api/due-dates/${seriesId}/occurrence`, {
          originalDueAt: dueDate.originalDueAt,
          title: values.title,
          dueAt,
        });
      }
      if (scope === "following" && dueDate?.originalDueAt) {
        return api.post(`/api/due-dates/${seriesId}/split`, {
          originalDueAt: dueDate.originalDueAt,
          action: "edit",
          title: values.title,
          dueAt,
          rrule: values.rrule || null,
        });
      }
      const body = {
        title: values.title,
        dueAt,
        rrule: values.rrule || null,
        reminders: values.reminders,
      };
      if (isEdit) return api.patch(`/api/due-dates/${seriesId}`, body);
      return api.post("/api/due-dates", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["due-dates"] });
      onOpenChange(false);
    },
  });

  const del = useMutation({
    mutationFn: async (scope: SaveScope) => {
      if (scope === "occurrence" && dueDate?.originalDueAt) {
        return api.del(
          `/api/due-dates/${seriesId}/occurrence?originalDueAt=${encodeURIComponent(
            dueDate.originalDueAt,
          )}`,
        );
      }
      if (scope === "following" && dueDate?.originalDueAt) {
        return api.post(`/api/due-dates/${seriesId}/split`, {
          originalDueAt: dueDate.originalDueAt,
          action: "delete",
        });
      }
      return api.del(`/api/due-dates/${seriesId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["due-dates"] });
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
    if (!dueDate) return;
    if (isOccurrence) {
      setPending({ type: "delete" });
      return;
    }
    del.mutate("series");
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (getLastEdited() !== "due-date") return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (pending) setPending(null);
        else onOpenChange(false);
        return;
      }
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA") return;
      if (e.shiftKey) {
        if (!dueDate) return;
        e.preventDefault();
        requestDelete();
        return;
      }
      e.preventDefault();
      handleSubmit(requestSave)();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dueDate, pending, isOccurrence]);

  if (!open) return null;

  const defaultWeekday = watchedDueAt
    ? fromUtc(fromLocalInputValue(watchedDueAt)).weekday - 1
    : 0;

  return (
    <div
      className="relative flex max-h-[80vh] flex-col overflow-hidden rounded-lg border bg-background shadow-2xl"
      role="dialog"
      aria-modal="false"
      onFocusCapture={() => markEditingFocus("due-date")}
      onPointerDownCapture={() => markEditingFocus("due-date")}
    >
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-base font-semibold">
          {isEdit ? "Edit due date" : "New due date"}
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
          <Label htmlFor="dueAt">Due at</Label>
          <Input id="dueAt" type="datetime-local" {...register("dueAt")} />
          {errors.dueAt && (
            <p className="text-xs text-destructive">{errors.dueAt.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label>Repeat</Label>
          <RecurrenceEditor
            value={watchedRule ?? null}
            onChange={(rule) => setValue("rrule", rule, { shouldDirty: true })}
            defaultWeekday={defaultWeekday}
            dtstart={watchedDueAt ? fromLocalInputValue(watchedDueAt) : undefined}
          />
        </div>

        <div className="space-y-1">
          <Label>Reminders</Label>
          <OffsetReminderEditor
            value={watchedReminders ?? []}
            onChange={(next) =>
              setValue("reminders", next, { shouldDirty: true })
            }
          />
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
                ? "Save changes to this due date only, or this and every following one in the series?"
                : "Delete this due date only, or this and every following one in the series?"}
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
                This due date
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

