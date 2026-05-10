"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MenuIcon, XIcon } from "lucide-react";
import { laTodayISO } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/actions/auth";

/**
 * Compact header for the mobile calendar. The desktop CalendarHeader is
 * keyboard- and switcher-heavy; here we only show the wordmark + a hamburger
 * that opens a panel with everything else.
 */
export function MobileHeader({ email }: { email?: string | null }) {
  const [open, setOpen] = useState(false);
  const todayISO = laTodayISO();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="flex h-12 items-center justify-between border-b px-4">
      <Link href={`/calendar/day/${todayISO}`} className="text-base font-bold">
        Calendar
      </Link>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent"
      >
        <MenuIcon className="size-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-full w-72 max-w-[85vw] flex-col gap-1 bg-background p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
              >
                <XIcon className="size-5" />
              </button>
            </div>

            <Link
              href={`/calendar/day/${todayISO}`}
              onClick={() => setOpen(false)}
              className="rounded-md border px-3 py-2.5 text-base hover:bg-accent"
            >
              Today
            </Link>

            <div className="my-2 h-px bg-border" />

            <Link
              href="/calendar/settings/categories"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2.5 text-base text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Categories
            </Link>
            <Link
              href="/calendar/settings/shortcuts"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2.5 text-base text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Shortcuts
            </Link>
            <Link
              href="/calendar/settings/notifications"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2.5 text-base text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Notifications
            </Link>

            <div className="mt-auto space-y-2 pt-4">
              {email && (
                <div className="px-3 text-xs text-muted-foreground">{email}</div>
              )}
              <form action={signOutAction}>
                <Button
                  variant="outline"
                  size="sm"
                  type="submit"
                  className="w-full"
                >
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
