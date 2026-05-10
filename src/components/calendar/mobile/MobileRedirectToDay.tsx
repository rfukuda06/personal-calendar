"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * Mounted on /calendar/week/[date] and /calendar/month/[date]. On phone-sized
 * viewports it bounces the user to the day view for the same anchor date —
 * mobile only supports day view.
 */
export function MobileRedirectToDay({ dateISO }: { dateISO: string }) {
  const isMobile = useIsMobile();
  const router = useRouter();
  useEffect(() => {
    if (isMobile) router.replace(`/calendar/day/${dateISO}`);
  }, [isMobile, dateISO, router]);
  return null;
}
