"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import { CalendarHeader } from "./CalendarHeader";
import { MobileHeader } from "./mobile/MobileHeader";

export function HeaderSwitch({ email }: { email?: string | null }) {
  const isMobile = useIsMobile();
  return isMobile ? <MobileHeader email={email} /> : <CalendarHeader email={email} />;
}
