/**
 * Tiny module-level pub/sub so the three editing surfaces (Event dialog,
 * BigEvent dialog, Todo edit row) can coordinate mutual exclusion.
 *
 * Rules:
 *   - Opening an Event dialog cancels any open BigEvent dialog.
 *   - Opening a BigEvent dialog cancels any open Event dialog.
 *   - Opening a Todo edit cancels both Event and BigEvent dialogs.
 *   - Notes (Todos) are *not* cancelled by Event/BigEvent activity — they
 *     persist alongside.
 *
 * Each surface calls `announceEditing("event"|"big-event"|"note")` when it
 * opens; subscribers decide whether to close themselves based on the source.
 */

export type EditingSource = "event" | "big-event" | "due-date" | "note";

type Listener = (source: EditingSource) => void;

const listeners = new Set<Listener>();

// Most-recently-touched surface. The Todo edit row can coexist with an
// Event/BigEvent/DueDate dialog (see rules above), but only one of them
// should respond to a global Enter/Shift+Enter at a time. Each surface
// updates this on open/focus and gates its own keyboard handler on it.
let lastEdited: EditingSource | null = null;

export function announceEditing(source: EditingSource) {
  lastEdited = source;
  for (const fn of listeners) fn(source);
}

export function markEditingFocus(source: EditingSource) {
  lastEdited = source;
}

export function getLastEdited(): EditingSource | null {
  return lastEdited;
}

export function subscribeEditing(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
