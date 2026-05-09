"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { laDay, laTodayISO, TZ, weekRange } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/actions/auth";

type View = "day" | "week" | "month";

const LAST_VIEW_KEY = "lastCalendarView";

export function CalendarHeader({ email }: { email?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const match = /^\/calendar\/(day|week|month)(?:\/(\d{4}-\d{2}-\d{2}))?/.exec(
    pathname,
  );
  const view = match?.[1] as View | undefined;
  const dateISO = match?.[2];
  const todayISO = laTodayISO();
  const onSettings = pathname?.startsWith("/calendar/settings/") ?? false;

  // Remember the last calendar view+date so settings pages (categories,
  // shortcuts) can keep the day/week/month switcher highlighted, route the
  // links back to where the user came from, and let Esc navigate "back".
  const [lastView, setLastView] = useState<{ view: View; date: string } | null>(
    null,
  );
  useEffect(() => {
    if (view && dateISO) {
      const next = { view, date: dateISO };
      sessionStorage.setItem(LAST_VIEW_KEY, JSON.stringify(next));
      setLastView(next);
      return;
    }
    const stored = sessionStorage.getItem(LAST_VIEW_KEY);
    if (stored) {
      try {
        setLastView(JSON.parse(stored));
      } catch {
        // ignore corrupt value
      }
    }
  }, [view, dateISO]);

  const effectiveView: View = view ?? lastView?.view ?? "week";
  const effectiveDate = dateISO ?? lastView?.date ?? todayISO;

  let nav: React.ReactNode = null;
  if (view && dateISO) {
    const anchor = laDay(dateISO);
    let prevISO: string | null = null;
    let nextISO: string | null = null;
    let label = "";
    if (view === "day") {
      prevISO = anchor.minus({ days: 1 }).toISODate();
      nextISO = anchor.plus({ days: 1 }).toISODate();
      label = anchor.toFormat("cccc, LLL d, yyyy");
    } else if (view === "week") {
      const { start, end } = weekRange(anchor);
      prevISO = anchor.minus({ days: 7 }).toISODate();
      nextISO = anchor.plus({ days: 7 }).toISODate();
      label = `${start.toFormat("MMM d")} – ${end
        .minus({ days: 1 })
        .toFormat("MMM d, yyyy")}`;
    } else {
      prevISO = anchor.minus({ months: 1 }).startOf("month").toISODate();
      nextISO = anchor.plus({ months: 1 }).startOf("month").toISODate();
      label = anchor.toFormat("LLLL yyyy");
    }

    nav = (
      <div className="flex items-center gap-1">
        <Link
          href={`/calendar/${view}/${prevISO}`}
          className="rounded-md border px-2.5 py-1 hover:bg-accent"
          aria-label={`Previous ${view}`}
        >
          ←
        </Link>
        <Link
          href={`/calendar/${view}/${nextISO}`}
          className="rounded-md border px-2.5 py-1 hover:bg-accent"
          aria-label={`Next ${view}`}
        >
          →
        </Link>
        {view !== "day" && (
          <span className="ml-2 font-semibold">{label}</span>
        )}
      </div>
    );
  }

  // ←/→ navigate to prev/next in the current view. Skip when the user is
  // typing in an input/textarea (e.g., the event-title field) or holding a
  // modifier (so browser shortcuts like Cmd/Alt+←/→ for back/forward still
  // work).
  useEffect(() => {
    if (!view || !dateISO) return;
    const anchor = laDay(dateISO);
    let prev: string | null = null;
    let next: string | null = null;
    if (view === "day") {
      prev = anchor.minus({ days: 1 }).toISODate();
      next = anchor.plus({ days: 1 }).toISODate();
    } else if (view === "week") {
      prev = anchor.minus({ days: 7 }).toISODate();
      next = anchor.plus({ days: 7 }).toISODate();
    } else {
      prev = anchor.minus({ months: 1 }).startOf("month").toISODate();
      next = anchor.plus({ months: 1 }).startOf("month").toISODate();
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t?.isContentEditable
      ) {
        return;
      }
      // Arrow keys: prev/next in the current view.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const target = e.key === "ArrowLeft" ? prev : next;
        if (!target) return;
        e.preventDefault();
        router.push(`/calendar/${view}/${target}`);
        return;
      }
      // T: jump to today in the current view.
      const k = e.key.toLowerCase();
      if (k === "t") {
        e.preventDefault();
        router.push(`/calendar/${view}/${todayISO}`);
        return;
      }
      // D / W / M: switch view, preserving the anchor date.
      if (k === "d" || k === "w" || k === "m") {
        e.preventDefault();
        const target: View = k === "d" ? "day" : k === "w" ? "week" : "month";
        router.push(`/calendar/${target}/${dateISO}`);
        return;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, dateISO, router, todayISO]);

  // Each view link routes to the user's last anchor date in that view (or
  // today if there's no remembered date). On settings pages this keeps the
  // switcher pointed at where the user came from.
  const viewTarget = (v: View) => `/calendar/${v}/${effectiveDate}`;

  // Esc on settings pages bounces back to the remembered calendar view.
  useEffect(() => {
    if (!onSettings) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      router.push(`/calendar/${effectiveView}/${effectiveDate}`);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSettings, effectiveView, effectiveDate, router]);

  return (
    <header className="flex items-center gap-6 border-b px-4 py-2 text-sm">
      <Link href="/calendar/week" className="text-lg font-bold">
        Calendar
      </Link>

      <div className="flex items-center gap-3">
        <Link
          href={`/calendar/${effectiveView}/${todayISO}`}
          className="rounded-md border px-2.5 py-1 hover:bg-accent"
        >
          Today
        </Link>

        <div className="flex items-center overflow-hidden rounded-md border">
          {(["day", "week", "month"] as View[]).map((v) => {
          const active = effectiveView === v;
          return (
            <Link
              key={v}
              href={viewTarget(v)}
              className={`px-3 py-1 text-sm font-semibold uppercase tracking-wide ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              {v}
            </Link>
          );
        })}
        </div>
        {nav}
      </div>

      <div className="ml-auto flex items-center gap-4">
        <Link
          href="/calendar/settings/categories"
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          Categories
        </Link>
        <Link
          href="/calendar/settings/shortcuts"
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          Shortcuts
        </Link>
        <Link
          href="/calendar/settings/notifications"
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          Notifications
        </Link>
        <span className="text-muted-foreground">{email}</span>
        <form action={signOutAction}>
          <Button variant="outline" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
