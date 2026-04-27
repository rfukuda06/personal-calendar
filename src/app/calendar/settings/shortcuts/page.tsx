type Shortcut = { keys: string[]; description: string };

const navigation: Shortcut[] = [
  {
    keys: ["←"],
    description:
      "Go to the previous day, week, or month — depending on the current view.",
  },
  {
    keys: ["→"],
    description: "Go to the next day, week, or month.",
  },
  {
    keys: ["T"],
    description: "Jump to today in the current view.",
  },
  {
    keys: ["D"],
    description: "Switch to Day view (keeps the current anchor date).",
  },
  {
    keys: ["W"],
    description: "Switch to Week view.",
  },
  {
    keys: ["M"],
    description: "Switch to Month view.",
  },
];

const dialogs: Shortcut[] = [
  {
    keys: ["Enter"],
    description:
      "Save the event you're creating or editing. Inside the Notes field, Enter inserts a newline.",
  },
  {
    keys: ["Shift", "Enter"],
    description:
      "Delete the event you're editing. Has no effect when creating. Inside Notes: insert a newline.",
  },
  {
    keys: ["Esc"],
    description:
      "Cancel — close the dialog without saving any changes.",
  },
];

export default function ShortcutsPage() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Keyboard shortcuts</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Shortcuts that are wired up today. Arrow keys are skipped when you're
        typing in a text field, so they won't interfere with editing.
      </p>

      <Section title="Navigating the calendar" items={navigation} />
      <Section title="Inside an event dialog" items={dialogs} />
    </div>
  );
}

function Section({ title, items }: { title: string; items: Shortcut[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <ul className="divide-y rounded-md border">
        {items.map((s) => (
          <li
            key={s.keys.join("+") + s.description}
            className="flex items-start gap-4 px-4 py-3"
          >
            <div className="flex shrink-0 items-center gap-1">
              {s.keys.map((k, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && (
                    <span className="text-xs text-muted-foreground">+</span>
                  )}
                  <kbd className="inline-flex min-w-[2rem] items-center justify-center rounded border bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                    {k}
                  </kbd>
                </span>
              ))}
            </div>
            <p className="text-sm">{s.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
