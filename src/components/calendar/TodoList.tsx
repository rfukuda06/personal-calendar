"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, TrashIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { RecurrenceEditor } from "./RecurrenceEditor";
import { announceEditing, getLastEdited, markEditingFocus } from "@/lib/editingBus";
import { DateTime } from "luxon";

const TODO_COLOR = "#6b7280";

function weekdayFromISO(iso: string): number {
  return DateTime.fromISO(iso.slice(0, 10)).weekday - 1;
}

type Todo = {
  id: string;
  seriesId: string;
  title: string;
  dueDate: string;
  completedAt: string | null;
  rrule: string | null;
  isOccurrence: boolean;
  occurrenceDate: string | null;
};

/**
 * Right-rail todo list for Day view.
 *
 * Server returns: todos due today + incomplete todos rolled forward from
 * earlier dates (DESIGN_DECISIONS.md §9). The list shows a "rolled over"
 * badge for any item whose original dueDate is before the viewed day.
 *
 * Create + edit happen inline in the rail itself — no modal dialog.
 */
export function TodoList({ dateISO }: { dateISO: string }) {
  const qc = useQueryClient();

  const { data: todos = [] } = useQuery({
    queryKey: ["todos", dateISO],
    queryFn: () => api.get<Todo[]>(`/api/todos?date=${dateISO}`),
  });

  // Toggle completion. Recurring occurrences create/delete a TodoCompletion
  // row; non-recurring todos use the parent's completedAt column directly.
  const toggle = useMutation({
    mutationFn: (t: { todo: Todo; completed: boolean }) => {
      if (t.todo.isOccurrence && t.todo.occurrenceDate) {
        return api.post(`/api/todos/${t.todo.seriesId}/complete`, {
          occurrenceDate: t.todo.occurrenceDate.slice(0, 10),
          completed: t.completed,
        });
      }
      return api.patch(`/api/todos/${t.todo.seriesId}`, {
        completedAt: t.completed ? new Date().toISOString() : null,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });

  // Edit/delete entry points cover three cases:
  //   - non-recurring: PATCH/DELETE the parent row
  //   - recurring "this event only": PATCH/DELETE /exception (TodoException)
  //   - recurring "this and following": POST /split (truncate parent +
  //     optional new series)
  type EditData = {
    title?: string;
    rrule?: string | null;
  };
  type Scope = "series" | "occurrence" | "following";

  const update = useMutation({
    mutationFn: ({
      todo,
      data,
      scope,
    }: {
      todo: Todo;
      data: EditData;
      scope: Scope;
    }) => {
      if (scope === "occurrence" && todo.isOccurrence && todo.occurrenceDate) {
        return api.patch(`/api/todos/${todo.seriesId}/exception`, {
          occurrenceDate: todo.occurrenceDate.slice(0, 10),
          title: data.title,
        });
      }
      if (scope === "following" && todo.isOccurrence && todo.occurrenceDate) {
        return api.post(`/api/todos/${todo.seriesId}/split`, {
          occurrenceDate: todo.occurrenceDate.slice(0, 10),
          action: "edit",
          title: data.title,
          rrule: data.rrule,
        });
      }
      return api.patch(`/api/todos/${todo.seriesId}`, data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });

  const del = useMutation({
    mutationFn: ({ todo, scope }: { todo: Todo; scope: Scope }) => {
      if (scope === "occurrence" && todo.isOccurrence && todo.occurrenceDate) {
        return api.del(
          `/api/todos/${todo.seriesId}/exception?occurrenceDate=${encodeURIComponent(
            todo.occurrenceDate.slice(0, 10),
          )}`,
        );
      }
      if (scope === "following" && todo.isOccurrence && todo.occurrenceDate) {
        return api.post(`/api/todos/${todo.seriesId}/split`, {
          occurrenceDate: todo.occurrenceDate.slice(0, 10),
          action: "delete",
        });
      }
      return api.del(`/api/todos/${todo.seriesId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });

  const create = useMutation({
    mutationFn: (data: {
      title: string;
      dueDate: string;
      rrule: string | null;
    }) => api.post("/api/todos", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });

  const [newTitle, setNewTitle] = useState("");
  const [newRrule, setNewRrule] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState<
    | { type: "save"; todo: Todo; data: EditData }
    | { type: "delete"; todo: Todo }
    | null
  >(null);

  useEffect(() => {
    if (!pending) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Capture phase + stopPropagation so the focused TodoEditRow input
        // doesn't also see this Esc and cancel the edit out from under us.
        e.preventDefault();
        e.stopPropagation();
        setPending(null);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [pending]);

  function requestEditSave(todo: Todo, data: EditData) {
    if (todo.isOccurrence) {
      setPending({ type: "save", todo, data });
    } else {
      update.mutate(
        { todo, data, scope: "series" },
        { onSuccess: () => setEditingId(null) },
      );
    }
  }
  function requestEditDelete(todo: Todo) {
    if (todo.isOccurrence) {
      setPending({ type: "delete", todo });
    } else {
      del.mutate(
        { todo, scope: "series" },
        { onSuccess: () => setEditingId(null) },
      );
    }
  }
  function resolvePending(scope: "occurrence" | "following") {
    if (!pending) return;
    if (pending.type === "save") {
      update.mutate(
        { todo: pending.todo, data: pending.data, scope },
        {
          onSuccess: () => {
            setPending(null);
            setEditingId(null);
          },
        },
      );
    } else {
      del.mutate(
        { todo: pending.todo, scope },
        {
          onSuccess: () => {
            setPending(null);
            setEditingId(null);
          },
        },
      );
    }
  }

  function submitNew() {
    const title = newTitle.trim();
    if (!title) return;
    create.mutate({
      title,
      dueDate: dateISO,
      rrule: newRrule,
    });
    setNewTitle("");
    setNewRrule(null);
  }

  function cancelNew() {
    setNewTitle("");
    setNewRrule(null);
  }

  // Once focus leaves the title input (e.g. after clicking a recurrence
  // button), the input's onKeyDown stops handling Enter. Bind at the document
  // level so Enter still submits the new todo. Mirrors TodoEditRow's pattern.
  useEffect(() => {
    if (!newTitle.trim() || editingId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement) return;
      if (target?.tagName === "TEXTAREA") return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      submitNew();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTitle, newRrule, editingId]);

  return (
    <aside className="relative flex w-72 shrink-0 flex-col border-l bg-muted/20">
      <div className="border-b px-3 py-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Todos
          </h2>
          <button
            type="button"
            onClick={submitNew}
            disabled={!newTitle.trim() || create.isPending}
            className="rounded bg-black px-2 py-0.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
          >
            Create
          </button>
        </div>
        <div className="mt-1 space-y-1">
          <div>
            <FieldLabel>Title</FieldLabel>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onFocus={() => announceEditing("note")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitNew();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelNew();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Add a todo…"
            />
          </div>
          <div>
            <FieldLabel>Repeat</FieldLabel>
            <RecurrenceEditor
              value={newRrule}
              onChange={setNewRrule}
              defaultWeekday={weekdayFromISO(dateISO)}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {todos.length === 0 && (
          <p className="px-1 py-2 text-xs italic text-muted-foreground">
            No todos for this day.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {todos.map((t) => {
            const completed = !!t.completedAt;
            const rolledOver = t.dueDate.slice(0, 10) < dateISO;
            const isEditing = editingId === t.id;
            return (
              <li key={t.id}>
                {isEditing ? (
                  <TodoEditRow
                    todo={t}
                    onCancel={() => setEditingId(null)}
                    onSave={(data) => requestEditSave(t, data)}
                    onDelete={() => requestEditDelete(t)}
                  />
                ) : (
                  <div
                    className="group flex items-center gap-2 rounded px-2 py-1 text-white"
                    style={{ backgroundColor: TODO_COLOR }}
                  >
                    <input
                      type="checkbox"
                      checked={completed}
                      onChange={(e) => {
                        toggle.mutate({
                          todo: t,
                          completed: e.target.checked,
                        });
                        // Don't keep focus on the checkbox — CalendarHeader's
                        // keyboard shortcuts skip events when an input is
                        // focused, which would silently disable ←/→/T/D/W/M.
                        e.target.blur();
                      }}
                      className="size-5 shrink-0 cursor-pointer accent-white"
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-sm ${
                          completed ? "opacity-70 line-through" : ""
                        }`}
                      >
                        {t.title}
                      </div>
                      {rolledOver && !completed && (
                        <div className="text-[10px] uppercase tracking-wide opacity-90">
                          rolled over
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(t.id);
                        announceEditing("note");
                      }}
                      className="shrink-0 rounded p-1 opacity-70 hover:bg-white/20 hover:opacity-100"
                      aria-label="Edit todo"
                    >
                      <PencilIcon className="size-3.5" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {pending && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onClick={() => setPending(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPending(null);
          }}
        >
          <div
            className="w-full rounded-lg border bg-background p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <p className="mb-4 text-sm">
              {pending.type === "save"
                ? "Save changes to this todo only, or this and every following todo in the series?"
                : "Delete this todo only, or this and every following todo in the series?"}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={update.isPending || del.isPending}
                onClick={() => resolvePending("following")}
                className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
              >
                This and following
              </button>
              <button
                type="button"
                disabled={update.isPending || del.isPending}
                onClick={() => resolvePending("occurrence")}
                className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                This todo
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function TodoEditRow({
  todo,
  onCancel,
  onSave,
  onDelete,
}: {
  todo: Todo;
  onCancel: () => void;
  onSave: (data: { title: string; rrule: string | null }) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(todo.title);
  const [rrule, setRrule] = useState<string | null>(todo.rrule);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commit() {
    const next = title.trim();
    if (!next) {
      onCancel();
      return;
    }
    if (next === todo.title && (rrule || null) === todo.rrule) {
      onCancel();
      return;
    }
    onSave({ title: next, rrule: rrule || null });
  }

  // Once focus leaves the title input (e.g. after clicking a recurrence
  // button), the input's onKeyDown stops handling Enter/Esc/Shift+Enter.
  // Bind those at the document level so the row's keyboard contract holds
  // regardless of which control inside the row is focused. Skip when a
  // modal (the this/following confirmation) is open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA") return;
      if (target instanceof HTMLInputElement && target === inputRef.current) {
        // The input's own handler covers this case.
        return;
      }
      if (document.querySelector('[aria-modal="true"]')) return;
      // When a coexisting Event/BigEvent/DueDate dialog is also open, defer
      // to whichever surface was touched most recently.
      if (getLastEdited() !== "note") return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      e.preventDefault();
      if (e.shiftKey) onDelete();
      else commit();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, rrule]);

  return (
    <div
      className="rounded border border-primary/40 bg-background p-1.5"
      onFocusCapture={() => markEditingFocus("note")}
      onPointerDownCapture={() => markEditingFocus("note")}
    >
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey) {
              e.preventDefault();
              onDelete();
            } else if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="flex-1 bg-transparent text-sm outline-none"
        />
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete"
        >
          <TrashIcon className="size-3.5" />
        </button>
      </div>
      <div className="mt-1">
        <RecurrenceEditor
          value={rrule}
          onChange={setRrule}
          defaultWeekday={weekdayFromISO(todo.dueDate)}
        />
      </div>
      <div className="mt-1 flex justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={commit}
          className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:opacity-90"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}
