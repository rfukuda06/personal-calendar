import { redirect } from "next/navigation";
import { laTodayISO } from "@/lib/time";

export default function DayIndex() {
  redirect(`/calendar/day/${laTodayISO()}`);
}
