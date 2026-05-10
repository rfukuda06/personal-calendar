"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import { DayView } from "./DayView";
import { MobileDayView } from "./mobile/MobileDayView";

export function DayViewSwitch({ dateISO }: { dateISO: string }) {
  const isMobile = useIsMobile();
  return isMobile ? <MobileDayView dateISO={dateISO} /> : <DayView dateISO={dateISO} />;
}
