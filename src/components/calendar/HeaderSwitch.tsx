"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import { CalendarHeader } from "./CalendarHeader";

// Mobile renders no top header — the date bar inside MobileDayView lives at
// the top of the viewport, and sign-out is folded into that bar.
export function HeaderSwitch({ email }: { email?: string | null }) {
  const isMobile = useIsMobile();
  if (isMobile) return null;
  return <CalendarHeader email={email} />;
}
